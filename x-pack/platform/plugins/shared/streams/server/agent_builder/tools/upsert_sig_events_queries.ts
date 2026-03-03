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
        kql: z.string().optional().describe('KQL filter (required for row queries)'),
        query_type: z
          .enum(['row', 'stats'])
          .default('row')
          .describe('Query type: row for filtering, stats for aggregation'),
        esql_query: z.string().optional().describe('Raw ES|QL query (required for stats queries)'),
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
    description: `Write sig events query definitions for a stream. These define the KQL/ES|QL queries that detect significant events.

When to use:
- Creating new detection queries for a stream
- Updating existing query definitions
- Adding STATS-based aggregation queries`,
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
            },
          }))
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
              data: { message: `Failed to upsert sig events queries: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
