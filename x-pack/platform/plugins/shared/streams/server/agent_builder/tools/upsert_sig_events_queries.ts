/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { v4 as uuidv4 } from 'uuid';
import { z } from '@kbn/zod';
import { ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type { BuiltinToolDefinition, StaticToolRegistration } from '@kbn/agent-builder-server';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type { StreamsToolsDependencies } from './types';

const upsertSigEventsQueriesSchema = z.object({
  streamName: z.string().describe('The name of the stream to write queries for'),
  queries: z
    .array(
      z.object({
        title: z.string().describe('Query title'),
        kql: z
          .string()
          .optional()
          .describe('KQL filter. Required for row queries. Use "*" to match all events.'),
        query_type: z
          .enum(['row', 'stats'])
          .default('row')
          .describe('ES|QL execution type: row for event-level filtering, stats for aggregation'),
        query_purpose: z
          .enum(['detection', 'exclusion', 'stats', 'baseline', 'correlation'])
          .default('detection')
          .describe(
            'Purpose of the query: detection (default, detects significant events), exclusion (noise-canceling, filters known-noisy patterns), stats (aggregation metrics like error rates), baseline (normal operating range reference), correlation (co-occurrence analysis)'
          ),
        esql_query: z
          .string()
          .optional()
          .describe(
            'Raw ES|QL query string. Required for stats queries (query_type: stats). Must include a FROM clause targeting the stream. Example: "FROM logs | STATS error_rate = COUNT_IF(http.response.status_code >= 500) / COUNT(*) BY BUCKET(@timestamp, 5m)"'
          ),
      })
    )
    .describe('Queries to upsert'),
});

export const UPSERT_SIG_EVENTS_QUERIES_TOOL_ID = `${internalNamespaces.streams}.upsert_sig_events_queries`;

export const createUpsertSigEventsQueriesTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof upsertSigEventsQueriesSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof upsertSigEventsQueriesSchema> = {
    id: UPSERT_SIG_EVENTS_QUERIES_TOOL_ID,
    type: ToolType.builtin,
    description: `Write sig events query definitions for a stream. Supports multiple query purposes:

- detection (default): KQL row queries that detect specific significant events (errors, failures, anomalies)
- exclusion: KQL row queries that identify known-noisy patterns to filter out (health checks, heartbeats, debug logs)
- stats: Raw ES|QL aggregation queries for metrics like error rates, throughput, latency percentiles
- baseline: Aggregation queries capturing normal operating ranges as anomaly detection references
- correlation: Aggregation queries surfacing co-occurring patterns across fields or streams

When to use:
- Creating new detection queries for a stream
- Adding noise-canceling exclusion queries to suppress known-good patterns
- Adding STATS-based aggregation queries for error rates, throughput, or latency
- Adding baseline queries to establish normal operating ranges
- Updating existing query definitions`,
    schema: upsertSigEventsQueriesSchema,
    tags: ['streams', 'queries'],
    handler: async (toolParams, { request }) => {
      try {
        const { QueryService } = await import('../../lib/streams/assets/query/query_service');
        const queryService = new QueryService(deps.core, deps.logger);
        const queryClient = await queryService.getClientWithRequest({ request });

        const streamsClient = await deps.getStreamsClient(request);
        const definition = await streamsClient.getStream(toolParams.streamName);

        await queryClient.bulk(
          definition,
          toolParams.queries.map((q) => ({
            index: {
              id: uuidv4(),
              title: q.title,
              kql: { query: q.kql ?? '*' },
              query_type: q.query_type,
              query_purpose: q.query_purpose,
              esql_override: q.esql_query,
            },
          })),
          { createRules: false }
        );

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                message: `Upserted ${toolParams.queries.length} queries for stream ${toolParams.streamName}`,
              },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: {
                message: `Failed to upsert sig events queries: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
