/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { ToolType } from '@kbn/agent-builder-common';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type { BuiltinToolDefinition } from '@kbn/agent-builder-server';
import { createErrorResult, createOtherResult } from '@kbn/agent-builder-server';
import type { Logger } from '@kbn/core/server';
import dedent from 'dedent';
import type { ObservabilityAgentBuilderCoreSetup } from '../../../types';
import { getAgentBuilderResourceAvailability } from '../../../utils/get_agent_builder_resource_availability';
import { callStreamsQueryPromote } from './call_streams_internal';

const schema = z.object({
  query_id: z
    .string()
    .describe(
      'The ID of the significant event query to promote (e.g. the query_id returned by suggest_query).'
    ),
});

export const STREAMS_PROMOTE_QUERY_TOOL_ID = `${internalNamespaces.streams}.promote_query`;

export const createPromoteQueryTool = ({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): BuiltinToolDefinition<typeof schema> => ({
  id: STREAMS_PROMOTE_QUERY_TOOL_ID,
  type: ToolType.builtin,
  description: dedent`
    Promotes an unbacked significant event query to an active Kibana rule so it
    begins detecting events automatically.

    IMPORTANT: Only use this for CRITICAL or VERY HIGH importance queries where
    immediate automated detection is essential. Examples:
    - Production-impacting error patterns that require instant alerting
    - Security-relevant events that must be detected in real time
    - SLO-threatening conditions that need continuous monitoring

    For lower-importance or exploratory queries, do NOT promote — leave them
    unbacked for human review in the Streams UI.

    When to use:
    - After calling suggest_query for a pattern that is critical to detect immediately
    - To activate a previously suggested query that has proven its value

    When NOT to use:
    - For queries that are exploratory or low severity
    - When the query has not been validated against real data
    - For patterns that are already covered by an existing active rule
  `,
  schema,
  tags: ['streams', 'queries', 'write'],
  availability: {
    cacheMode: 'space',
    handler: async ({ request }) => {
      return getAgentBuilderResourceAvailability({ core, request, logger });
    },
  },
  handler: async (params, { request, spaceId, logger: toolLogger }) => {
    try {
      const [coreStart] = await core.getStartServices();

      const result = await callStreamsQueryPromote(
        request,
        coreStart,
        spaceId,
        [params.query_id]
      );

      return {
        results: [
          createOtherResult({
            type: 'promote_query',
            data: {
              success: true,
              query_id: params.query_id,
              result,
            },
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLogger.error(`promote_query failed: ${message}`);
      return {
        results: [
          createErrorResult({
            message: `Promote query failed: ${message}`,
          }),
        ],
      };
    }
  },
});
