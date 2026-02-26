/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { ToolCallback } from '@kbn/inference-common';
import { omit } from 'lodash';
import type { FeatureClient } from '../../../streams/feature/feature_client';
import type { QueryClient } from '../../../streams/assets/query/query_client';
import { parseError } from '../../../streams/errors/parse_error';
import { SecurityError } from '../../../streams/errors/security_error';
import type {
  GetStreamFeaturesArgs,
  SearchEventsArgs,
  GetQueryDefinitionsArgs,
  GetQueryResultsArgs,
} from './tool_schemas';

const DEFAULT_TIME_RANGE_MINUTES = 15;
const DEFAULT_SAMPLE_EVENTS = 5;
const MAX_SEARCH_SIZE = 50;
const DEFAULT_SEARCH_SIZE = 10;
const DEFAULT_FEATURE_LIMIT = 50;

interface ToolCallbackDependencies {
  esClient: ElasticsearchClient;
  queryClient: QueryClient;
  featureClient: FeatureClient;
  logger: Logger;
}

export function createGetStreamFeaturesCallback({
  featureClient,
  logger,
}: Pick<ToolCallbackDependencies, 'featureClient' | 'logger'>): ToolCallback {
  return async (toolCall) => {
    const args = toolCall.function.arguments as GetStreamFeaturesArgs;
    try {
      const { hits, total } = await featureClient.getFeatures(args.streamName, {
        type: args.type,
        limit: args.limit ?? DEFAULT_FEATURE_LIMIT,
      });

      const features = hits.map((f) => ({
        id: f.id,
        type: f.type,
        subtype: f.subtype,
        title: f.title,
        description: f.description,
        confidence: f.confidence,
        tags: f.tags,
      }));

      return {
        response: { features, total, count: features.length },
      };
    } catch (error) {
      logger.warn(`get_stream_features failed for ${args.streamName}: ${getErrorMsg(error)}`);
      return {
        response: { features: [], total: 0, count: 0, error: getErrorMsg(error) },
      };
    }
  };
}

export function createSearchEventsCallback({
  esClient,
  logger,
}: Pick<ToolCallbackDependencies, 'esClient' | 'logger'>): ToolCallback {
  return async (toolCall) => {
    const args = toolCall.function.arguments as SearchEventsArgs;
    const timeRange = args.timeRangeMinutes ?? DEFAULT_TIME_RANGE_MINUTES;
    const size = Math.min(args.size ?? DEFAULT_SEARCH_SIZE, MAX_SEARCH_SIZE);

    try {
      const response = await esClient.search<Record<string, unknown>>({
        index: args.streamName,
        size,
        query: {
          bool: {
            filter: [
              {
                range: {
                  '@timestamp': {
                    gte: `now-${timeRange}m`,
                    lte: 'now',
                  },
                },
              },
              ...(args.kql
                ? [
                    {
                      query_string: {
                        query: args.kql,
                        default_operator: 'AND' as const,
                      },
                    },
                  ]
                : []),
            ],
          },
        },
        sort: [{ '@timestamp': { order: 'desc' as const } }],
        track_total_hits: true,
      });

      const totalHits =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : response.hits.total?.value ?? 0;

      const events = response.hits.hits.map((hit) =>
        JSON.stringify(omit(hit._source ?? {}, '_id'))
      );

      return {
        response: { events, totalHits, returnedCount: events.length },
      };
    } catch (error) {
      logger.warn(`search_events failed for ${args.streamName}: ${getErrorMsg(error)}`);
      return {
        response: { events: [], totalHits: 0, returnedCount: 0, error: getErrorMsg(error) },
      };
    }
  };
}

export function createGetQueryDefinitionsCallback({
  queryClient,
  logger,
}: Pick<ToolCallbackDependencies, 'queryClient' | 'logger'>): ToolCallback {
  return async (toolCall) => {
    const args = toolCall.function.arguments as GetQueryDefinitionsArgs;
    try {
      const queries = await queryClient.getAssets(args.streamName);
      const definitions = queries.map((q) => ({
        title: q.query.title,
        kql: q.query.kql.query,
        featureName: q.query.feature?.name,
      }));

      return {
        response: { definitions, count: definitions.length },
      };
    } catch (error) {
      logger.warn(`get_query_definitions failed for ${args.streamName}: ${getErrorMsg(error)}`);
      return {
        response: { definitions: [], count: 0, error: getErrorMsg(error) },
      };
    }
  };
}

export function createGetQueryResultsCallback({
  esClient,
  queryClient,
  logger,
}: Pick<ToolCallbackDependencies, 'esClient' | 'queryClient' | 'logger'>): ToolCallback {
  return async (toolCall) => {
    const args = toolCall.function.arguments as GetQueryResultsArgs;
    const timeRange = args.timeRangeMinutes ?? DEFAULT_TIME_RANGE_MINUTES;
    const maxSamples = args.maxSampleEvents ?? DEFAULT_SAMPLE_EVENTS;

    try {
      const queries = await queryClient.getAssets(args.streamName);

      const results = await Promise.all(
        queries.map(async (query) => {
          try {
            const response = await esClient.search<{
              original_source: Record<string, unknown>;
            }>({
              index: '.alerts-streams.alerts-default',
              size: maxSamples,
              query: {
                bool: {
                  filter: [
                    {
                      range: {
                        '@timestamp': {
                          gte: `now-${timeRange}m`,
                          lte: 'now',
                        },
                      },
                    },
                    {
                      term: {
                        'kibana.alert.rule.uuid': query.rule_id,
                      },
                    },
                  ],
                },
              },
              track_total_hits: true,
            });

            const count =
              typeof response.hits.total === 'number'
                ? response.hits.total
                : response.hits.total?.value ?? 0;

            if (count === 0) return null;

            const sampleEvents = response.hits.hits.map((hit) =>
              JSON.stringify(omit(hit._source?.original_source ?? {}, '_id'))
            );

            return {
              queryTitle: query.query.title,
              kql: query.query.kql.query,
              featureName: query.query.feature?.name,
              eventCount: count,
              sampleEvents,
            };
          } catch (err) {
            const { type, message } = parseError(err);
            if (type === 'security_exception') {
              throw new SecurityError(
                `Cannot read significant events, insufficient privileges: ${message}`,
                { cause: err instanceof Error ? err : undefined }
              );
            }
            return null;
          }
        })
      );

      const queryResults = results.filter((r): r is NonNullable<typeof r> => r !== null);

      return {
        response: {
          queryResults,
          queriesWithEvents: queryResults.length,
          totalQueries: queries.length,
        },
      };
    } catch (error) {
      if (error instanceof SecurityError) throw error;
      logger.warn(`get_query_results failed for ${args.streamName}: ${getErrorMsg(error)}`);
      return {
        response: {
          queryResults: [],
          queriesWithEvents: 0,
          totalQueries: 0,
          error: getErrorMsg(error),
        },
      };
    }
  };
}

function getErrorMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
