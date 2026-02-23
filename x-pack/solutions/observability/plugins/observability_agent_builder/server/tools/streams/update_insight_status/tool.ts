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
import { callStreamsInsightUpdateStatus } from './call_streams_internal';

const schema = z.object({
  stream_name: z.string().describe('The stream the insight belongs to.'),
  insight_uuid: z.string().describe('The UUID of the insight to update.'),
  status: z
    .enum(['new', 'acknowledged', 'resolved', 'dismissed'])
    .describe('The new status for the insight.'),
});

export const STREAMS_UPDATE_INSIGHT_STATUS_TOOL_ID = `${internalNamespaces.streams}.update_insight_status`;

export const createUpdateInsightStatusTool = ({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): BuiltinToolDefinition<typeof schema> => ({
  id: STREAMS_UPDATE_INSIGHT_STATUS_TOOL_ID,
  type: ToolType.builtin,
  description: dedent`
    Updates the lifecycle status of an existing insight.

    When to use:
    - After verifying an insight is valid, transition it to "acknowledged"
    - When an issue described in an insight has been resolved, set it to "resolved"
    - When an insight is no longer relevant or was a false positive, set it to "dismissed"
    - During investigation, to track which insights have been reviewed

    Status transitions:
    - new → acknowledged: The insight has been reviewed and confirmed
    - new/acknowledged → resolved: The underlying issue has been fixed
    - new/acknowledged → dismissed: The insight is not actionable or is a false positive
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

      const result = await callStreamsInsightUpdateStatus(
        request,
        coreStart,
        spaceId,
        params.stream_name,
        params.insight_uuid,
        { status: params.status }
      );

      return {
        results: [
          createOtherResult({
            type: 'update_insight_status',
            data: { success: true, insight: result },
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLogger.error(`update_insight_status failed: ${message}`);
      return {
        results: [createErrorResult({ message: `Update insight status failed: ${message}` })],
      };
    }
  },
});
