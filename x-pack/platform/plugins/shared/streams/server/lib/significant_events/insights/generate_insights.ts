/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { BoundInferenceClient, ChatCompletionTokenCount } from '@kbn/inference-common';
import { sumTokens } from '@kbn/streams-ai';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { Streams } from '@kbn/streams-schema';
import type { InsightsResult } from '@kbn/streams-schema';
import type { LogMeta } from '@kbn/logging';
import type { QueryClient } from '../../streams/assets/query/query_client';
import type { StreamsClient } from '../../streams/client';
import type { InsightClient } from '../../streams/insight/insight_client';
import type { FeatureClient } from '../../streams/feature/feature_client';
import { getErrorMessage } from '../../streams/errors/parse_error';
import { SummarizeQueriesPrompt } from './prompts/summarize_queries/prompt';
import { SummarizeStreamsPrompt } from './prompts/summarize_streams/prompt';
import { extractInsightsFromResponse, collectQueryData, type QueryData } from './utils';
import type { ParsedInsight } from './schema';

function insightToPersistedInput(insight: ParsedInsight, streamName: string) {
  return {
    id: `task-${streamName}-${insight.title.toLowerCase().replace(/\s+/g, '-').slice(0, 60)}`,
    stream_name: streamName,
    title: insight.title,
    description: insight.description,
    impact: insight.impact,
    category: (insight.category ?? 'other') as
      | 'anomaly'
      | 'trend'
      | 'correlation'
      | 'error_spike'
      | 'performance'
      | 'capacity'
      | 'other',
    source: 'task' as const,
    confidence: insight.confidence ?? 70,
    evidence: insight.evidence,
    recommendations: insight.recommendations,
  };
}

export async function generateInsights({
  streamsClient,
  queryClient,
  esClient,
  inferenceClient,
  insightClient,
  featureClient,
  signal,
  logger,
  streamNames,
}: {
  streamsClient: StreamsClient;
  queryClient: QueryClient;
  esClient: ElasticsearchClient;
  inferenceClient: BoundInferenceClient;
  insightClient?: InsightClient;
  featureClient?: FeatureClient;
  signal: AbortSignal;
  logger: Logger;
  /** When provided, only generate insights for these streams. Otherwise all streams are used. */
  streamNames?: string[];
}): Promise<InsightsResult> {
  const allStreams = await streamsClient.listStreams();
  let streams = allStreams;
  if (streamNames !== undefined && streamNames.length > 0) {
    const streamNamesSet = new Set(streamNames);
    streams = allStreams.filter((s) => streamNamesSet.has(s.name));
  }
  const streamInsightsResults = await Promise.all(
    streams.map(async (stream) => {
      const streamInsightResult = await generateStreamInsights({
        stream,
        queryClient,
        esClient,
        inferenceClient,
        insightClient,
        featureClient,
        signal,
        logger,
      });
      return {
        streamName: stream.name,
        ...streamInsightResult,
      };
    })
  );

  // Filter out streams with no insights
  const streamInsightsWithData = streamInsightsResults.filter(
    (result) => result.insights.length > 0
  );

  const tokensUsed = streamInsightsResults.reduce<ChatCompletionTokenCount>(
    (acc, result) => sumTokens(acc, result.tokensUsed),
    { prompt: 0, completion: 0, total: 0 }
  );

  // If no stream insights, return empty
  if (streamInsightsWithData.length === 0) {
    return {
      insights: [],
      tokensUsed,
    };
  }

  try {
    const response = await inferenceClient.prompt({
      prompt: SummarizeStreamsPrompt,
      input: {
        streamInsights: JSON.stringify(streamInsightsWithData),
      },
      abortSignal: signal,
    });

    const insights = extractInsightsFromResponse(response, logger);

    if (insightClient && insights.length > 0) {
      await persistInsights(insightClient, insights, streamInsightsWithData, logger);
    }

    return {
      insights,
      tokensUsed: sumTokens(tokensUsed, response.tokens),
    };
  } catch (error) {
    if (
      getErrorMessage(error).includes(`The request exceeded the model's maximum context length`)
    ) {
      logger.debug(
        `Context too big when generating system insights, number of streams: ${streamInsightsWithData.length}`,
        { error } as LogMeta
      );
      return {
        insights: [],
        tokensUsed,
      };
    }

    throw error;
  }
}

async function persistInsights(
  insightClient: InsightClient,
  insights: ParsedInsight[],
  streamInsightsWithData: Array<{ streamName: string }>,
  logger: Logger
): Promise<void> {
  const primaryStream = streamInsightsWithData[0]?.streamName ?? 'unknown';
  try {
    const insightInputs = insights.map((insight) =>
      insightToPersistedInput(insight, primaryStream)
    );
    await insightClient.bulkUpsert(primaryStream, insightInputs);
    logger.debug(`Persisted ${insights.length} insights for stream ${primaryStream}`);
  } catch (err) {
    logger.warn(`Failed to persist insights: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function generateStreamInsights({
  stream,
  queryClient,
  esClient,
  inferenceClient,
  insightClient,
  featureClient,
  signal,
  logger,
}: {
  stream: Streams.all.Definition;
  queryClient: QueryClient;
  esClient: ElasticsearchClient;
  inferenceClient: BoundInferenceClient;
  insightClient?: InsightClient;
  featureClient?: FeatureClient;
  signal: AbortSignal;
  logger: Logger;
}): Promise<InsightsResult> {
  const queries = await queryClient.getAssets(stream.name);

  const queryDataResults = await Promise.all(
    queries.map((query) =>
      collectQueryData({
        query,
        esClient,
      })
    )
  );

  const queryDataList = queryDataResults.filter((data): data is QueryData => data !== undefined);

  if (queryDataList.length === 0) {
    return {
      insights: [],
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
    };
  }

  let featuresContext = '';
  if (featureClient) {
    try {
      const { hits: features } = await featureClient.getFeatures(stream.name);
      if (features.length > 0) {
        const featureSummaries = features.slice(0, 20).map((f) => ({
          type: f.type,
          subtype: f.subtype,
          title: f.title,
          description: f.description,
          confidence: f.confidence,
        }));
        featuresContext = JSON.stringify(featureSummaries);
      }
    } catch {
      logger.debug(`Could not fetch features for stream ${stream.name}`);
    }
  }

  let previousInsightsContext = '';
  if (insightClient) {
    try {
      const { hits: recentInsights } = await insightClient.getInsights(stream.name, {
        limit: 10,
      });
      if (recentInsights.length > 0) {
        const insightSummaries = recentInsights.map((i) => ({
          title: i.title,
          impact: i.impact,
          category: i.category,
          status: i.status,
          created_at: i.created_at,
        }));
        previousInsightsContext = JSON.stringify(insightSummaries);
      }
    } catch {
      logger.debug(`Could not fetch previous insights for stream ${stream.name}`);
    }
  }

  const crossSignalContext = await collectCrossSignalContext({ esClient, logger });

  try {
    const response = await inferenceClient.prompt({
      prompt: SummarizeQueriesPrompt,
      input: {
        streamName: stream.name,
        queries: JSON.stringify(queryDataList),
        features: featuresContext,
        previousInsights: previousInsightsContext,
        crossSignalContext,
      },
      abortSignal: signal,
    });

    const insights = extractInsightsFromResponse(response, logger);

    return {
      insights,
      tokensUsed: response.tokens ?? { prompt: 0, completion: 0, total: 0 },
    };
  } catch (error) {
    if (
      getErrorMessage(error).includes(`The request exceeded the model's maximum context length`)
    ) {
      logger.debug(
        `Context too big when generating insights for stream ${stream.name}, number of queries: ${queryDataList.length}`,
        { error } as LogMeta
      );
      return {
        insights: [],
        tokensUsed: { prompt: 0, completion: 0, total: 0 },
      };
    }

    throw error;
  }
}

async function collectCrossSignalContext({
  esClient,
  logger,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
}): Promise<string> {
  const sections: string[] = [];

  try {
    const alertsResponse = await esClient.search({
      index: '.alerts-*',
      size: 20,
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { gte: 'now-1h' } } },
            { term: { 'kibana.alert.status': 'active' } },
          ],
          must_not: [{ term: { 'kibana.alert.rule.category': 'Streams' } }],
        },
      },
      _source: [
        'kibana.alert.rule.name',
        'kibana.alert.rule.category',
        'kibana.alert.reason',
        'kibana.alert.severity',
        'service.name',
        'host.name',
      ],
      sort: [{ '@timestamp': { order: 'desc' } }],
    });

    const alerts = alertsResponse.hits.hits.map((hit) => hit._source).filter(Boolean);

    if (alerts.length > 0) {
      sections.push(JSON.stringify({ activeAlerts: alerts }));
    }
  } catch {
    logger.debug('Could not fetch cross-signal alerts');
  }

  try {
    const servicesResponse = await esClient.search({
      index: 'metrics-apm*',
      size: 0,
      query: {
        bool: {
          filter: [
            { range: { '@timestamp': { gte: 'now-15m' } } },
            { exists: { field: 'service.name' } },
          ],
        },
      },
      aggs: {
        services: {
          terms: { field: 'service.name', size: 20 },
          aggs: {
            avg_latency: { avg: { field: 'transaction.duration.us' } },
            error_rate: {
              filter: { term: { 'event.outcome': 'failure' } },
            },
            total: { value_count: { field: 'event.outcome' } },
          },
        },
      },
    });

    interface ServiceBucket {
      key: string;
      doc_count: number;
      avg_latency: { value: number | null };
      error_rate: { doc_count: number };
      total: { value: number };
    }

    const serviceAggs = (servicesResponse.aggregations as Record<string, unknown>)?.services as
      | { buckets?: ServiceBucket[] }
      | undefined;
    if (serviceAggs?.buckets && serviceAggs.buckets.length > 0) {
      const serviceHealth = serviceAggs.buckets.map((bucket) => ({
        service: bucket.key,
        requests: bucket.doc_count,
        avgLatencyMs: bucket.avg_latency.value ? Math.round(bucket.avg_latency.value / 1000) : null,
        errorRate:
          bucket.total.value > 0
            ? Math.round((bucket.error_rate.doc_count / bucket.total.value) * 100)
            : 0,
      }));
      sections.push(JSON.stringify({ serviceHealth }));
    }
  } catch {
    logger.debug('Could not fetch APM service health');
  }

  return sections.join('\n');
}
