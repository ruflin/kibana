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

const getSigEventsQueriesSchema = z.object({
  streamName: z.string().describe('The name of the stream to get sig events queries for'),
});

export const GET_SIG_EVENTS_QUERIES_TOOL_ID = `${internalNamespaces.streams}.get_sig_events_queries`;

export const createGetSigEventsQueriesTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof getSigEventsQueriesSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof getSigEventsQueriesSchema> = {
    id: GET_SIG_EVENTS_QUERIES_TOOL_ID,
    type: ToolType.builtin,
    description: `Read sig events query definitions for a stream. These are the KQL/ES|QL queries that detect significant events.

When to use:
- Understanding what queries are monitoring a stream
- Getting query context before generating discoveries
- Reviewing existing detection rules for a stream`,
    schema: getSigEventsQueriesSchema,
    tags: ['streams', 'queries'],
    handler: async (toolParams, { request }) => {
      try {
        const { QueryService } = await import('../../lib/streams/assets/query/query_service');
        const queryService = new QueryService(deps.core, deps.logger);
        const queryClient = await queryService.getClientWithRequest({ request });
        const queries = await queryClient.getAssets(toolParams.streamName);

        return {
          results: [
            {
              type: ToolResultType.other,
              data: { streamName: toolParams.streamName, queries },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to get sig events queries: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
