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
import { diffCountHandler } from './handler';

export const OBSERVABILITY_DIFF_COUNT_TOOL_ID = 'observability.diff_count';

const diffCountSchema = z.object({
  index: z.string().describe(indexDescription),
  timeField: z.string().default('@timestamp').describe('Timestamp field name.'),
  ...timeRangeSchemaRequired,
  testExpression: z
    .string()
    .describe(
      'Boolean ES|QL expression defining the test partition. Example: "@timestamp >= \\"2024-01-15T10:00:00Z\\""'
    ),
  baselineExpression: z
    .string()
    .optional()
    .describe(
      'Boolean ES|QL expression for the baseline partition. If omitted, uses the complement of testExpression.'
    ),
  byFields: z
    .array(z.string())
    .min(1)
    .describe(
      'Categorical fields to compare counts across partitions. Examples: ["log.level"], ["service.name", "error.type"].'
    ),
  direction: z
    .enum(['both', 'incr', 'decr'])
    .default('both')
    .describe(
      'Filter direction: "incr" for categories that increased, "decr" for decreased, "both" for either.'
    ),
  riskThreshold: z
    .number()
    .default(2.0)
    .describe('Minimum relative risk to report. 2.0 means at least a 2x change.'),
  significanceThreshold: z
    .number()
    .default(0.05)
    .describe('Maximum Bonferroni-corrected p-value to report.'),
  limit: z.number().default(10).describe('Maximum number of results to return.'),
});

export function createDiffCountTool({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): StaticToolRegistration<typeof diffCountSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof diffCountSchema> = {
    id: OBSERVABILITY_DIFF_COUNT_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      Compares count distributions of categorical fields between two partitions of data
      (e.g. before vs after an incident, healthy vs unhealthy requests).

      Uses relative risk and Fisher's exact test with Bonferroni correction to find
      categories with statistically significant changes. Similar to a volcano plot analysis
      or HoneyComb's BubbleUp for count data.

      When to use:
      - Finding which log categories, error types, or service names changed significantly
        after an incident started
      - Comparing error distributions between healthy and unhealthy time windows
      - Identifying which field values are over/under-represented in a problem set
      - Root cause analysis on categorical data (log levels, status codes, endpoints)

      Example: To find log categories that spiked after an incident at 10:00:
        index: "logs-*"
        testExpression: '@timestamp >= "2024-01-15T10:00:00Z"'
        baselineExpression: '@timestamp < "2024-01-15T09:50:00Z"'
        byFields: ["log.level", "service.name"]

      Do NOT use for:
      - Comparing numeric metric distributions (use diff_metric instead)
      - Finding outlier values in a metric (use detect_outliers)
    `,
    schema: diffCountSchema,
    tags: ['observability', 'root-cause', 'comparison', 'logs'],
    availability: {
      cacheMode: 'space',
      handler: async ({ request }) => {
        return getAgentBuilderResourceAvailability({ core, request, logger });
      },
    },
    handler: async (toolParams, context) => {
      try {
        const { phase, results, query } = await diffCountHandler({
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
        logger.error(`diff_count tool failed: ${error.message}`);
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
