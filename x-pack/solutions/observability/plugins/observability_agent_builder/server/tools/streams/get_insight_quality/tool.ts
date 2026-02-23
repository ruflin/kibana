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
import { callStreamsInsightQuality } from './call_streams_internal';

const schema = z.object({
  stream_name: z.string().describe('The stream to get insight quality metrics for.'),
});

export const STREAMS_GET_INSIGHT_QUALITY_TOOL_ID = `${internalNamespaces.streams}.get_insight_quality`;

export const createGetInsightQualityTool = ({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): BuiltinToolDefinition<typeof schema> => ({
  id: STREAMS_GET_INSIGHT_QUALITY_TOOL_ID,
  type: ToolType.builtin,
  description: dedent`
    Returns quality metrics for insights in a stream based on user feedback.

    When to use:
    - Before generating new insights, check which categories/patterns have been dismissed
    - To understand which types of insights are most valuable to SREs
    - To calibrate confidence scores based on historical accuracy
    - To identify patterns that should not be regenerated

    Returns:
    - Total insight count and count with feedback
    - Feedback action breakdown (helpful, not_helpful, acknowledged, dismissed)
    - Per-category quality (helpful vs dismissed ratio)
    - Average confidence score for each feedback action

    Use this data to avoid generating insights that match frequently dismissed patterns
    and to prioritize categories that users find most helpful.
  `,
  schema,
  tags: ['streams', 'insights', 'read'],
  availability: {
    cacheMode: 'space',
    handler: async ({ request }) => {
      return getAgentBuilderResourceAvailability({ core, request, logger });
    },
  },
  handler: async (params, { request, spaceId, logger: toolLogger }) => {
    try {
      const [coreStart] = await core.getStartServices();

      const result = await callStreamsInsightQuality(
        request,
        coreStart,
        spaceId,
        params.stream_name
      );

      return {
        results: [
          createOtherResult({
            type: 'get_insight_quality',
            data: result,
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLogger.error(`get_insight_quality failed: ${message}`);
      return {
        results: [createErrorResult({ message: `Get insight quality failed: ${message}` })],
      };
    }
  },
});
