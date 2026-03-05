/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type { BuiltinToolDefinition, StaticToolRegistration } from '@kbn/agent-builder-server';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type { StreamsToolsDependencies } from './types';

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

const getQueryResultsSchema = z.object({
  streamName: z.string().describe('Stream name'),
  queryId: z.string().describe('Query ID to execute'),
  from: z.string().default('now-1h').describe('Start time (e.g., "now-1h")'),
  to: z.string().default('now').describe('End time (e.g., "now")'),
});

export const GET_QUERY_RESULTS_TOOL_ID = `${internalNamespaces.streams}.get_query_results`;

export const createGetQueryResultsTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof getQueryResultsSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof getQueryResultsSchema> = {
    id: GET_QUERY_RESULTS_TOOL_ID,
    type: ToolType.builtin,
    description: `Execute a specific sig events query by ID and return its alert results for a given time range. Queries the alerts index for events matching the query's rule.

When to use:
- Viewing actual alert events produced by a specific sig events query
- Investigating what a query detected in a given time window
- Getting sample events for a known query ID`,
    schema: getQueryResultsSchema,
    tags: ['streams', 'queries', 'results'],
    handler: async (toolParams, { request }) => {
      try {
        const { QueryService } = await import('../../lib/streams/assets/query/query_service');
        const queryService = new QueryService(deps.core, deps.logger);
        const queryClient = await queryService.getClientWithRequest({ request });
        const esClient = (await deps.getEsClient(request)).asCurrentUser;

        const queries = await queryClient.getAssets(toolParams.streamName);
        const query = queries.find((q) => q.query.id === toolParams.queryId);

        if (!query) {
          return {
            results: [
              {
                type: ToolResultType.error,
                data: {
                  message: `Query ${toolParams.queryId} not found in stream ${toolParams.streamName}`,
                },
              },
            ],
          };
        }

        const from = parseRelativeTime(toolParams.from);
        const to = parseRelativeTime(toolParams.to);

        const response = await esClient.search({
          index: '.alerts-streams.alerts-default',
          size: 20,
          query: {
            bool: {
              filter: [
                {
                  range: {
                    '@timestamp': { gte: from.toISOString(), lte: to.toISOString() },
                  },
                },
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
          results: [
            {
              type: ToolResultType.other,
              data: {
                query_title: query.query.title,
                total_hits:
                  typeof response.hits.total === 'number'
                    ? response.hits.total
                    : response.hits.total?.value ?? 0,
                events,
              },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to get query results: ${error instanceof Error ? error.message : String(error)}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
