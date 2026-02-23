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
import { attributeImpactHandler } from './handler';

export const OBSERVABILITY_ATTRIBUTE_IMPACT_TOOL_ID = 'observability.attribute_impact';

const attributeImpactSchema = z.object({
  index: z.string().describe(indexDescription),
  timeField: z.string().default('@timestamp').describe('Timestamp field name.'),
  ...timeRangeSchemaRequired,
  metricField: z
    .string()
    .describe('Target metric to analyze. Examples: "http.response.latency", "event.duration".'),
  testExpression: z
    .string()
    .describe('Boolean ES|QL expression defining the incident/test partition.'),
  baselineExpression: z
    .string()
    .optional()
    .describe('Boolean ES|QL expression for the baseline. Defaults to complement of test.'),
  covariates: z
    .array(z.string())
    .min(1)
    .describe(
      dedent`Attribute fields to analyze for impact on the metric.
        Examples: ["service.name", "host.name", "url.path", "user_agent.name"].
        Each attribute is analyzed independently for its contribution to the metric change.`
    ),
  limit: z.number().default(10).describe('Maximum number of results to return.'),
});

export function createAttributeImpactTool({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): StaticToolRegistration<typeof attributeImpactSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof attributeImpactSchema> = {
    id: OBSERVABILITY_ATTRIBUTE_IMPACT_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      Decomposes the change in a metric between two partitions into per-attribute
      contributions using shift-share analysis.

      For each attribute value, reports:
      - **Mix impact**: how much the change in proportion of that attribute contributed
        (covariate shift — e.g. "we got more slow-endpoint requests")
      - **Shift impact**: how much the change in the metric for that attribute contributed
        (concept drift — e.g. "requests to this endpoint got slower")
      - **Total score**: mix + shift impact

      When to use:
      - Understanding WHY a metric (latency, error rate) changed after an incident
      - Attributing metric changes to specific services, endpoints, regions, or user agents
      - Distinguishing between "traffic mix changed" vs "behavior changed" explanations
      - Root cause analysis: which attributes are driving the overall metric change

      Example: To find what's driving a latency increase after 10:00:
        metricField: "http.response.latency"
        testExpression: '@timestamp >= "2024-01-15T10:00:00Z"'
        covariates: ["service.name", "url.path", "host.name"]

      Do NOT use for:
      - Comparing count distributions (use diff_count)
      - Finding outlier entities (use detect_outliers)
    `,
    schema: attributeImpactSchema,
    tags: ['observability', 'root-cause', 'attribution', 'influence'],
    availability: {
      cacheMode: 'space',
      handler: async ({ request }) => {
        return getAgentBuilderResourceAvailability({ core, request, logger });
      },
    },
    handler: async (toolParams, context) => {
      try {
        const { phase, results, query } = await attributeImpactHandler({
          esClient: context.esClient.asCurrentUser,
          logger,
          params: toolParams,
        });

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                phase,
                query,
                totalResults: results.length,
                items: results,
              },
            },
          ],
        };
      } catch (error) {
        logger.error(`attribute_impact tool failed: ${error.message}`);
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
