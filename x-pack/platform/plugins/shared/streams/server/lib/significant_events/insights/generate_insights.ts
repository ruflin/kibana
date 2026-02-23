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
import type { Insight, InsightsResult } from '@kbn/streams-schema';
import type { LogMeta } from '@kbn/logging';
import type { QueryClient } from '../../streams/assets/query/query_client';
import type { StreamsClient } from '../../streams/client';
import type { InsightClient } from '../../streams/insight/insight_client';
import { getErrorMessage } from '../../streams/errors/parse_error';
import { SummarizeQueriesPrompt } from './prompts/summarize_queries/prompt';
import { SummarizeStreamsPrompt } from './prompts/summarize_streams/prompt';
import { extractInsightsFromResponse, collectQueryData, type QueryData } from './utils';

function insightToPersistedInput(insight: Insight, streamName: string) {
  return {
    id: `task-${streamName}-${insight.title.toLowerCase().replace(/\s+/g, '-').slice(0, 60)}`,
    stream_name: streamName,
    title: insight.title,
    description: insight.description,
    impact: insight.impact,
    category: 'other' as const,
    source: 'task' as const,
    confidence: 70,
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
  signal,
  logger,
  streamNames,
}: {
  streamsClient: StreamsClient;
  queryClient: QueryClient;
  esClient: ElasticsearchClient;
  inferenceClient: BoundInferenceClient;
  insightClient?: InsightClient;
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
  insights: Insight[],
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
    logger.warn(
      `Failed to persist insights: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function generateStreamInsights({
  stream,
  queryClient,
  esClient,
  inferenceClient,
  signal,
  logger,
}: {
  stream: Streams.all.Definition;
  queryClient: QueryClient;
  esClient: ElasticsearchClient;
  inferenceClient: BoundInferenceClient;
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

  // Filter out queries with no events
  const queryDataList = queryDataResults.filter((data): data is QueryData => data !== undefined);

  if (queryDataList.length === 0) {
    return {
      insights: [],
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
    };
  }

  try {
    const response = await inferenceClient.prompt({
      prompt: SummarizeQueriesPrompt,
      input: {
        streamName: stream.name,
        queries: JSON.stringify(queryDataList),
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
