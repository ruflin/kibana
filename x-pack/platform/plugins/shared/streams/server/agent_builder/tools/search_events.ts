/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type { BuiltinToolDefinition, StaticToolRegistration } from '@kbn/agent-builder-server';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type { StreamsToolsDependencies } from './types';

const searchEventsSchema = z.object({
  streamName: z.string().describe('Stream name to query'),
  esql: z
    .string()
    .describe(
      'ES|QL query string (e.g., "FROM stream | WHERE status >= 500 | LIMIT 10" or "FROM stream | STATS count = COUNT(*) BY host.name")'
    ),
});

export const SEARCH_EVENTS_TOOL_ID = `${internalNamespaces.streams}.search_events`;

export const createSearchEventsTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof searchEventsSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof searchEventsSchema> = {
    id: SEARCH_EVENTS_TOOL_ID,
    type: ToolType.builtin,
    description: `Execute an ES|QL query against a stream. Supports both row queries (FROM ... | WHERE ...) for individual events and STATS queries (FROM ... | STATS ... BY ...) for aggregations. The FROM clause is automatically rewritten to target the specified stream.

When to use:
- Running ad-hoc queries to investigate patterns in a stream
- Aggregating data with STATS to find top values, counts, or distributions
- Searching for specific events matching a condition
- Validating hypotheses about data patterns`,
    schema: searchEventsSchema,
    tags: ['streams', 'analysis', 'esql'],
    handler: async (toolParams, { request }) => {
      try {
        const esClient = (await deps.getEsClient(request)).asCurrentUser;
        const esqlQuery = toolParams.esql.replace(/FROM\s+\S+/i, `FROM ${toolParams.streamName}`);

        const result = await esClient.esql.query({
          query: esqlQuery,
          format: 'json',
        });

        const typedResult = result as {
          columns?: Array<{ name: string }>;
          values?: unknown[][];
        };
        const columns = typedResult.columns ?? [];
        const values = typedResult.values ?? [];
        const truncated = values.length > 100;

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                columns: columns.map((c) => c.name),
                rows: truncated ? values.slice(0, 100) : values,
                total_rows: values.length,
                truncated,
              },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to execute ES|QL query: ${error instanceof Error ? error.message : String(error)}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
