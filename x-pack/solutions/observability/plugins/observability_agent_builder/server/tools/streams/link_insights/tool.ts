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
import { callStreamsInsightLink } from './call_streams_internal';

const schema = z.object({
  stream_name: z.string().describe('The stream the insight belongs to.'),
  insight_uuid: z.string().describe('The UUID of the insight to link.'),
  parent_insight_id: z
    .string()
    .optional()
    .describe('UUID of the parent insight (e.g., the original incident insight).'),
  related_insight_ids: z
    .array(z.string())
    .optional()
    .describe('UUIDs of related insights to link (appended to existing relations).'),
});

export const STREAMS_LINK_INSIGHTS_TOOL_ID = `${internalNamespaces.streams}.link_insights`;

export const createLinkInsightsTool = ({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): BuiltinToolDefinition<typeof schema> => ({
  id: STREAMS_LINK_INSIGHTS_TOOL_ID,
  type: ToolType.builtin,
  description: dedent`
    Links insights together to create parent/child or related relationships.

    When to use:
    - To connect a follow-up insight to the original incident insight (parent)
    - To link insights that describe different aspects of the same incident
    - When an error spike insight is related to a performance degradation insight
    - To build an investigation timeline by linking sequential findings

    Examples:
    - "Error spike started" → later "Error spike resolved" (parent/child)
    - "High latency in service A" ↔ "Connection pool exhaustion in service B" (related)
  `,
  schema,
  tags: ['streams', 'insights', 'write'],
  availability: {
    cacheMode: 'space',
    handler: async ({ request }) => {
      return getAgentBuilderResourceAvailability({ core, request, logger });
    },
  },
  handler: async (params, { request, spaceId, logger: toolLogger }) => {
    try {
      const [coreStart] = await core.getStartServices();

      const result = await callStreamsInsightLink(
        request,
        coreStart,
        spaceId,
        params.stream_name,
        params.insight_uuid,
        {
          parent_insight_id: params.parent_insight_id,
          related_insight_ids: params.related_insight_ids,
        }
      );

      return {
        results: [
          createOtherResult({
            type: 'link_insights',
            data: { success: true, insight: result },
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLogger.error(`link_insights failed: ${message}`);
      return {
        results: [createErrorResult({ message: `Link insights failed: ${message}` })],
      };
    }
  },
});
