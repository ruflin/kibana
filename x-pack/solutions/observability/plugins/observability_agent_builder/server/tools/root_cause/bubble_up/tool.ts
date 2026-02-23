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
import type { Logger } from '@kbn/core/server';
import dedent from 'dedent';
import type { ObservabilityAgentBuilderCoreSetup } from '../../../types';
import { timeRangeSchemaRequired, indexDescription } from '../../../utils/tool_schemas';
import { getAgentBuilderResourceAvailability } from '../../../utils/get_agent_builder_resource_availability';
import { bubbleUpHandler } from './handler';

export const OBSERVABILITY_BUBBLE_UP_TOOL_ID = 'observability.bubble_up';

const bubbleUpSchema = z.object({
  index: z.string().describe(indexDescription),
  timeField: z.string().default('@timestamp').describe('Timestamp field name.'),
  ...timeRangeSchemaRequired,
  slowExpression: z.string().describe(
    dedent`Boolean ES|QL expression defining "bad" requests or events.
        Examples:
        - 'http.response.latency > 500' (slow requests)
        - 'http.response.status_code >= 500' (server errors)
        - 'event.outcome == "failure"' (failed events)`
  ),
  attributeFields: z
    .array(z.string())
    .min(1)
    .describe(
      dedent`Fields to check for over/under-representation in the slow set.
        Examples: ["service.name", "host.name", "url.path", "http.request.method", "user_agent.name"]`
    ),
  riskThreshold: z.number().default(2.0).describe('Minimum relative risk to report.'),
  significanceThreshold: z.number().default(0.05).describe('Maximum p-value to report.'),
  limit: z.number().default(10).describe('Maximum results per attribute.'),
});

export function createBubbleUpTool({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): StaticToolRegistration<typeof bubbleUpSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof bubbleUpSchema> = {
    id: OBSERVABILITY_BUBBLE_UP_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      HoneyComb BubbleUp-style analysis: finds which attribute values are statistically
      over-represented in a "bad" set (slow requests, errors, failures) compared to the
      overall population.

      Runs diff_count analysis for each attribute field, using the slow/bad expression
      as the test partition. This quickly identifies which services, endpoints, hosts,
      or other dimensions are correlated with the problem.

      When to use:
      - "Why are requests slow?" → find which endpoints, services, or hosts are over-represented in slow requests
      - "What's different about the errors?" → find which attributes correlate with error responses
      - Quick triage: which dimensions should I investigate first?

      Example: Find what's different about slow requests:
        slowExpression: 'http.response.latency > 500'
        attributeFields: ["service.name", "url.path", "host.name", "http.request.method"]

      Do NOT use for:
      - Comparing two time windows (use diff_count or diff_metric)
      - Understanding metric distribution changes (use diff_metric)
      - Attributing metric changes to composition vs behavior (use attribute_impact)
    `,
    schema: bubbleUpSchema,
    tags: ['observability', 'root-cause', 'bubble-up', 'triage'],
    availability: {
      cacheMode: 'space',
      handler: async ({ request }) => {
        return getAgentBuilderResourceAvailability({ core, request, logger });
      },
    },
    handler: async (toolParams, context) => {
      try {
        const { results } = await bubbleUpHandler({
          esClient: context.esClient.asCurrentUser,
          logger,
          params: toolParams,
        });

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                totalAttributes: results.length,
                items: results,
              },
            },
          ],
        };
      } catch (error) {
        logger.error(`bubble_up tool failed: ${error.message}`);
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: error.message, stack: error.stack },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
}
