/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, IScopedClusterClient, Logger } from '@kbn/core/server';
import type { ToolCallback, ToolSchema } from '@kbn/inference-common';
import { z } from '@kbn/zod';
import zodToJsonSchema from 'zod-to-json-schema';
import type { DiscoveryClient } from '../../discoveries/discovery_client';
import type { FeatureClient } from '../../streams/feature/feature_client';
import type { QueryClient } from '../../streams/assets/query/query_client';
import { readSignificantEventsFromAlertsIndices } from '../read_significant_events_from_alerts_indices';
import { getErrorMessage } from '../../streams/errors/parse_error';

const TIME_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

const parseRelativeTime = (value: string): Date => {
  if (value === 'now') {
    return new Date();
  }
  const match = value.match(/^now-(\d+)([smhdw])$/);
  if (match) {
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    return new Date(Date.now() - amount * (TIME_UNIT_MS[unit] ?? 0));
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid time value: ${value}`);
  }
  return parsed;
};

// --- Tool schemas ---

const getSigEventsWithChangePointsSchema = z.object({
  streamNames: z.array(z.string()).describe('Stream names to analyze'),
  from: z.string().default('now-1h').describe('Start time (e.g., "now-1h", "now-24h")'),
  to: z.string().default('now').describe('End time (e.g., "now")'),
  bucketSize: z.string().default('5m').describe('Bucket size for time series (e.g., "5m", "1h")'),
});

const getLogPatternsSchema = z.object({
  streamName: z.string().describe('Stream name to analyze'),
  field: z
    .string()
    .default('message')
    .describe('Field to categorize (usually "message")'),
  from: z.string().default('now-1h').describe('Start time'),
  to: z.string().default('now').describe('End time'),
  size: z.number().default(20).describe('Number of top patterns to return'),
});

const runLogRateAnalysisSchema = z.object({
  streamName: z.string().describe('Stream name to analyze'),
  baselineFrom: z.string().describe('Baseline window start (e.g., "now-2h")'),
  baselineTo: z.string().describe('Baseline window end (e.g., "now-1h")'),
  deviationFrom: z.string().describe('Deviation window start (e.g., "now-1h")'),
  deviationTo: z.string().describe('Deviation window end (e.g., "now")'),
  field: z.string().optional().describe('Optional field to focus analysis on'),
});

const searchEventsSchema = z.object({
  streamName: z.string().describe('Stream name to query'),
  esql: z.string().describe('ES|QL query string (e.g., "FROM stream | WHERE status >= 500 | LIMIT 10" or "FROM stream | STATS count = COUNT(*) BY host.name")'),
});

const getQueryResultsSchema = z.object({
  streamName: z.string().describe('Stream name'),
  queryId: z.string().describe('Query ID to execute'),
  from: z.string().default('now-1h').describe('Start time'),
  to: z.string().default('now').describe('End time'),
});

const getStreamFeaturesSchema = z.object({
  streamName: z.string().describe('Stream name to get features for'),
  type: z.array(z.string()).optional().describe('Feature types to filter by'),
  minConfidence: z.number().optional().describe('Minimum confidence score'),
  limit: z.number().optional().describe('Maximum number of features to return'),
});

const searchDiscoveriesSchema = z.object({
  query: z.string().describe('Natural language search query'),
  streamName: z.string().optional().describe('Filter by stream name'),
  severity: z.string().optional().describe('Filter by severity'),
  minRelevanceScore: z.number().optional().describe('Minimum relevance score'),
});

const getQueryDefinitionsSchema = z.object({
  streamName: z.string().describe('Stream name to get query definitions for'),
});

// --- Tool definitions ---

export interface PipelineToolDependencies {
  esClient: ElasticsearchClient;
  scopedClusterClient: IScopedClusterClient;
  queryClient: QueryClient;
  featureClient: FeatureClient;
  discoveryClient: DiscoveryClient;
  logger: Logger;
}

function toToolSchema(zodSchema: z.ZodType): ToolSchema {
  return zodToJsonSchema(zodSchema, { $refStrategy: 'none' }) as unknown as ToolSchema;
}

export interface PipelineTool {
  description: string;
  schema: ToolSchema;
}

export function createPipelineToolDefinitions(): Record<string, PipelineTool> {
  return {
    get_sig_events_with_change_points: {
      description:
        'Read sig events occurrences with change point analysis. Returns per-query: occurrence time series, change point type (spike/dip/step_change/trend_change/distribution_change/stationary), p-value, and timestamp. This is the PRIMARY analysis tool — start here to identify which queries show statistically significant changes.',
      schema: toToolSchema(getSigEventsWithChangePointsSchema),
    },
    get_log_patterns: {
      description:
        'Categorize log messages and return top patterns with counts. Helps identify dominant error patterns and exceptions in a stream.',
      schema: toToolSchema(getLogPatternsSchema),
    },
    run_log_rate_analysis: {
      description:
        'Compare a baseline time window against a deviation window to identify which field/value combinations correlate with throughput changes. Returns significant items with p-values. Helps identify root causes of spikes/dips.',
      schema: toToolSchema(runLogRateAnalysisSchema),
    },
    search_events: {
      description:
        'Execute an ES|QL query against a stream. Supports both row queries (FROM ... | WHERE ...) for individual events and STATS queries (FROM ... | STATS ... BY ...) for aggregations.',
      schema: toToolSchema(searchEventsSchema),
    },
    get_query_results: {
      description:
        'Execute a specific sig events query by ID and return its results for a given time range.',
      schema: toToolSchema(getQueryResultsSchema),
    },
    get_stream_features: {
      description:
        'Read extracted features for a stream. Features describe systems, services, and components detected in the data.',
      schema: toToolSchema(getStreamFeaturesSchema),
    },
    search_discoveries: {
      description:
        'Search existing discoveries via semantic search. Use this to find related discoveries and build meta-discoveries.',
      schema: toToolSchema(searchDiscoveriesSchema),
    },
    get_query_definitions: {
      description:
        'Read existing sig events query definitions for a stream. Returns query titles, KQL filters, features, and severity scores.',
      schema: toToolSchema(getQueryDefinitionsSchema),
    },
  };
}

export function createPipelineToolCallbacks(
  deps: PipelineToolDependencies
): Record<string, ToolCallback> {
  const { esClient, scopedClusterClient, queryClient, featureClient, discoveryClient, logger } =
    deps;

  return {
    get_sig_events_with_change_points: async (toolCall) => {
      try {
        const args = getSigEventsWithChangePointsSchema.parse(toolCall.function.arguments);
        const from = parseRelativeTime(args.from);
        const to = parseRelativeTime(args.to);

        const results = await readSignificantEventsFromAlertsIndices(
          {
            streamNames: args.streamNames,
            from,
            to,
            bucketSize: args.bucketSize,
          },
          { queryClient, scopedClusterClient }
        );

        const summary = results.significant_events.map((event) => ({
          query_title: event.title,
          query_id: event.id,
          stream_name: event.stream_name,
          total_occurrences: event.occurrences.reduce(
            (sum: number, o: { count: number }) => sum + o.count,
            0
          ),
          change_points: event.change_points,
          feature: event.feature,
        }));

        return { response: { significant_events: summary, count: summary.length } };
      } catch (error) {
        logger.warn(`get_sig_events_with_change_points failed: ${getErrorMessage(error)}`);
        return { response: { error: getErrorMessage(error), significant_events: [], count: 0 } };
      }
    },

    get_log_patterns: async (toolCall) => {
      try {
        const args = getLogPatternsSchema.parse(toolCall.function.arguments);
        const from = parseRelativeTime(args.from);
        const to = parseRelativeTime(args.to);

        const response = await esClient.search({
          index: args.streamName,
          size: 0,
          query: {
            bool: {
              filter: [{ range: { '@timestamp': { gte: from.toISOString(), lte: to.toISOString() } } }],
            },
          },
          aggs: {
            log_patterns: {
              categorize_text: {
                field: args.field,
                size: args.size,
              },
            },
          },
        });

        const buckets = (response.aggregations?.log_patterns as { buckets?: Array<{ key: string; doc_count: number }> })?.buckets ?? [];
        const patterns = buckets.map((bucket) => ({
          pattern: bucket.key,
          count: bucket.doc_count,
        }));

        return { response: { patterns, count: patterns.length } };
      } catch (error) {
        logger.warn(`get_log_patterns failed: ${getErrorMessage(error)}`);
        return { response: { error: getErrorMessage(error), patterns: [], count: 0 } };
      }
    },

    run_log_rate_analysis: async (toolCall) => {
      try {
        const args = runLogRateAnalysisSchema.parse(toolCall.function.arguments);
        const baselineFrom = parseRelativeTime(args.baselineFrom);
        const baselineTo = parseRelativeTime(args.baselineTo);
        const deviationFrom = parseRelativeTime(args.deviationFrom);
        const deviationTo = parseRelativeTime(args.deviationTo);

        const [baselineResult, deviationResult] = await Promise.all([
          esClient.search({
            index: args.streamName,
            size: 0,
            query: {
              bool: {
                filter: [
                  { range: { '@timestamp': { gte: baselineFrom.toISOString(), lte: baselineTo.toISOString() } } },
                ],
              },
            },
            aggs: {
              total: { value_count: { field: '@timestamp' } },
              ...(args.field
                ? {
                    field_breakdown: {
                      terms: { field: args.field, size: 50 },
                    },
                  }
                : {
                    field_breakdown: {
                      significant_terms: { field: 'message.keyword', size: 20 },
                    },
                  }),
            },
          }),
          esClient.search({
            index: args.streamName,
            size: 0,
            query: {
              bool: {
                filter: [
                  { range: { '@timestamp': { gte: deviationFrom.toISOString(), lte: deviationTo.toISOString() } } },
                ],
              },
            },
            aggs: {
              total: { value_count: { field: '@timestamp' } },
              ...(args.field
                ? {
                    field_breakdown: {
                      terms: { field: args.field, size: 50 },
                    },
                  }
                : {
                    field_breakdown: {
                      significant_terms: { field: 'message.keyword', size: 20 },
                    },
                  }),
            },
          }),
        ]);

        const baselineTotal = (baselineResult.aggregations?.total as { value?: number })?.value ?? 0;
        const deviationTotal = (deviationResult.aggregations?.total as { value?: number })?.value ?? 0;

        const baselineBuckets = (baselineResult.aggregations?.field_breakdown as { buckets?: Array<{ key: string; doc_count: number }> })?.buckets ?? [];
        const deviationBuckets = (deviationResult.aggregations?.field_breakdown as { buckets?: Array<{ key: string; doc_count: number }> })?.buckets ?? [];

        const baselineMap = new Map(baselineBuckets.map((b) => [b.key, b.doc_count]));
        const significantChanges = deviationBuckets
          .map((b) => {
            const baselineCount = baselineMap.get(b.key) ?? 0;
            const change = baselineCount > 0 ? (b.doc_count - baselineCount) / baselineCount : b.doc_count > 0 ? Infinity : 0;
            return { field_value: b.key, baseline_count: baselineCount, deviation_count: b.doc_count, change_ratio: change };
          })
          .filter((item) => Math.abs(item.change_ratio) > 0.1)
          .sort((a, b) => Math.abs(b.change_ratio) - Math.abs(a.change_ratio))
          .slice(0, 20);

        return {
          response: {
            baseline_total: baselineTotal,
            deviation_total: deviationTotal,
            rate_change: baselineTotal > 0 ? (deviationTotal - baselineTotal) / baselineTotal : 0,
            significant_changes: significantChanges,
          },
        };
      } catch (error) {
        logger.warn(`run_log_rate_analysis failed: ${getErrorMessage(error)}`);
        return { response: { error: getErrorMessage(error) } };
      }
    },

    search_events: async (toolCall) => {
      try {
        const args = searchEventsSchema.parse(toolCall.function.arguments);
        const esqlQuery = args.esql.replace(/FROM\s+\S+/i, `FROM ${args.streamName}`);

        const result = await esClient.esql.query({
          query: esqlQuery,
          format: 'json',
        });

        const typedResult = result as { columns?: Array<{ name: string }>; values?: unknown[][] };
        const columns = typedResult.columns ?? [];
        const values = typedResult.values ?? [];

        if (values.length > 100) {
          return {
            response: {
              columns: columns.map((c) => c.name),
              rows: values.slice(0, 100),
              total_rows: values.length,
              truncated: true,
            },
          };
        }

        return {
          response: {
            columns: columns.map((c) => c.name),
            rows: values,
            total_rows: values.length,
            truncated: false,
          },
        };
      } catch (error) {
        logger.warn(`search_events failed: ${getErrorMessage(error)}`);
        return { response: { error: getErrorMessage(error) } };
      }
    },

    get_query_results: async (toolCall) => {
      try {
        const args = getQueryResultsSchema.parse(toolCall.function.arguments);
        const queries = await queryClient.getAssets(args.streamName);
        const query = queries.find((q) => q.query.id === args.queryId);

        if (!query) {
          return { response: { error: `Query ${args.queryId} not found in stream ${args.streamName}` } };
        }

        const from = parseRelativeTime(args.from);
        const to = parseRelativeTime(args.to);

        const response = await esClient.search({
          index: '.alerts-streams.alerts-default',
          size: 20,
          query: {
            bool: {
              filter: [
                { range: { '@timestamp': { gte: from.toISOString(), lte: to.toISOString() } } },
                { term: { 'kibana.alert.rule.uuid': query.rule_id } },
              ],
            },
          },
        });

        const events = response.hits.hits.map((hit) => {
          const source = hit._source as Record<string, unknown> | undefined;
          return source?.original_source ?? source ?? {};
        });

        return {
          response: {
            query_title: query.query.title,
            total_hits: typeof response.hits.total === 'number' ? response.hits.total : response.hits.total?.value ?? 0,
            events,
          },
        };
      } catch (error) {
        logger.warn(`get_query_results failed: ${getErrorMessage(error)}`);
        return { response: { error: getErrorMessage(error) } };
      }
    },

    get_stream_features: async (toolCall) => {
      try {
        const args = getStreamFeaturesSchema.parse(toolCall.function.arguments);
        const result = await featureClient.getFeatures(args.streamName, {
          type: args.type,
          minConfidence: args.minConfidence,
          limit: args.limit,
        });

        const features = result.hits.map((f) => ({
          id: f.id,
          title: f.title,
          type: f.type,
          subtype: f.subtype,
          description: f.description,
          confidence: f.confidence,
          properties: f.properties,
        }));

        return { response: { features, count: features.length } };
      } catch (error) {
        logger.warn(`get_stream_features failed: ${getErrorMessage(error)}`);
        return { response: { error: getErrorMessage(error), features: [], count: 0 } };
      }
    },

    search_discoveries: async (toolCall) => {
      try {
        const args = searchDiscoveriesSchema.parse(toolCall.function.arguments);
        const discoveries = await discoveryClient.searchDiscoveries({
          query: args.query,
          streamName: args.streamName,
          severity: args.severity,
          minRelevanceScore: args.minRelevanceScore,
          semanticSearch: true,
          size: 10,
        });

        const summaries = discoveries.map((d) => ({
          uuid: d.uuid,
          title: d.title,
          description: d.description,
          severity: d.severity,
          relevance_score: d.relevance_score,
          stream_refs: d.stream_refs,
          level: d.level,
          created_at: d.created_at,
        }));

        return { response: { discoveries: summaries, count: summaries.length } };
      } catch (error) {
        logger.warn(`search_discoveries failed: ${getErrorMessage(error)}`);
        return { response: { error: getErrorMessage(error), discoveries: [], count: 0 } };
      }
    },

    get_query_definitions: async (toolCall) => {
      try {
        const args = getQueryDefinitionsSchema.parse(toolCall.function.arguments);
        const queries = await queryClient.getAssets(args.streamName);

        const definitions = queries.map((q) => ({
          id: q.query.id,
          title: q.query.title,
          esql: q.query.esql.query,
          query_purpose: q.query.query_purpose ?? 'detection',
          severity_score: q.query.severity_score,
          rule_backed: q.rule_backed,
        }));

        return { response: { queries: definitions, count: definitions.length } };
      } catch (error) {
        logger.warn(`get_query_definitions failed: ${getErrorMessage(error)}`);
        return { response: { error: getErrorMessage(error), queries: [], count: 0 } };
      }
    },
  };
}
