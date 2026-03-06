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

const promoteQueriesSchema = z.object({
  streamName: z.string().describe('The name of the stream whose queries should be promoted'),
  queryIds: z
    .array(z.string())
    .optional()
    .describe(
      'Optional list of specific query IDs to promote. If omitted, all unbacked queries for the stream are promoted.'
    ),
});

export const PROMOTE_QUERIES_TOOL_ID = `${internalNamespaces.streams}.promote_queries`;

export const createPromoteQueriesTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof promoteQueriesSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof promoteQueriesSchema> = {
    id: PROMOTE_QUERIES_TOOL_ID,
    type: ToolType.builtin,
    description: `Promote sig events queries to active Kibana alerting rules. Queries that are "unbacked" exist as definitions but do not trigger alerts. Promoting them creates real Kibana rules that fire when the query matches.

When to use:
- After creating or reviewing sig events queries that should become active alerts
- When the user asks to enable, activate, or promote queries
- After generating queries via upsert_sig_events_queries and wanting them to produce alerts`,
    schema: promoteQueriesSchema,
    tags: ['streams', 'queries', 'alerts'],
    handler: async (toolParams, { request }) => {
      try {
        const { QueryService } = await import('../../lib/streams/assets/query/query_service');
        const queryService = new QueryService(deps.core, deps.logger);
        const queryClient = await queryService.getClientWithRequest({ request });

        const streamsClient = await deps.getStreamsClient(request);
        const definition = await streamsClient.getStream(toolParams.streamName);

        let queryIds = toolParams.queryIds;
        if (!queryIds || queryIds.length === 0) {
          const unbacked = await queryClient.getQueryLinks([toolParams.streamName], {
            ruleBacked: false,
          });
          queryIds = unbacked.map((link) => link.query.id);

          if (queryIds.length === 0) {
            return {
              results: [
                {
                  type: ToolResultType.other,
                  data: {
                    message: `No unbacked queries found for stream ${toolParams.streamName}. All queries already have active Kibana rules.`,
                    promoted: 0,
                    streamName: toolParams.streamName,
                  },
                },
              ],
            };
          }
        }

        const result = await queryClient.promoteQueries(definition, queryIds);

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                message: `Promoted ${result.promoted} queries to active Kibana alerting rules for stream ${toolParams.streamName}`,
                promoted: result.promoted,
                streamName: toolParams.streamName,
              },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to promote queries: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
