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
import { diffMetricHandler } from './handler';

export const OBSERVABILITY_DIFF_METRIC_TOOL_ID = 'observability.diff_metric';

const diffMetricSchema = z.object({
  index: z.string().describe(indexDescription),
  timeField: z.string().default('@timestamp').describe('Timestamp field name.'),
  ...timeRangeSchemaRequired,
  metricField: z
    .string()
    .describe(
      'Numeric field to compare distributions for. Examples: "system.cpu.total.pct", "http.response.latency".'
    ),
  testExpression: z.string().describe('Boolean ES|QL expression defining the test partition.'),
  baselineExpression: z
    .string()
    .optional()
    .describe('Boolean ES|QL expression for the baseline. Defaults to complement of test.'),
  byFields: z
    .array(z.string())
    .min(1)
    .describe(
      'Fields to partition the comparison by. Examples: ["host.name"], ["service.name", "container.id"].'
    ),
  normalize: z
    .enum(['std_dev', 'mean'])
    .default('std_dev')
    .describe(
      dedent`Normalization method for Wasserstein distance:
        - "std_dev": divide by baseline standard deviation (good for noisy metrics like CPU)
        - "mean": divide by baseline mean (good for stable positive metrics like latency)`
    ),
  direction: z
    .enum(['both', 'incr', 'decr'])
    .default('both')
    .describe('Filter: "incr" for increases, "decr" for decreases, "both" for either.'),
  riskThreshold: z
    .number()
    .default(2.0)
    .describe('Minimum normalized Wasserstein distance to report.'),
  significanceThreshold: z
    .number()
    .default(0.05)
    .describe('Maximum Bonferroni-corrected p-value to report.'),
  limit: z.number().default(10).describe('Maximum number of results to return.'),
});

export function createDiffMetricTool({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): StaticToolRegistration<typeof diffMetricSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof diffMetricSchema> = {
    id: OBSERVABILITY_DIFF_METRIC_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      Compares metric distributions between two partitions of data (e.g. before vs after
      an incident) to find which entities show the biggest distributional change.

      Uses normalized Wasserstein distance for effect size and a t-test approximation
      (falling back from Anderson-Darling) for significance, with Bonferroni correction.

      When to use:
      - Finding which hosts have the biggest CPU or memory change after an incident
      - Comparing latency distributions between healthy and degraded time windows
      - Identifying which services show anomalous metric behavior
      - Root cause analysis on numeric metrics partitioned by categorical dimensions

      Normalization guidance:
      - Use "std_dev" for noisy metrics (CPU utilization, memory usage)
      - Use "mean" for stable positive metrics (latency, request duration)

      Do NOT use for:
      - Comparing count distributions of categorical data (use diff_count)
      - Finding individual outlier values (use detect_outliers)
    `,
    schema: diffMetricSchema,
    tags: ['observability', 'root-cause', 'comparison', 'metrics'],
    availability: {
      cacheMode: 'space',
      handler: async ({ request }) => {
        return getAgentBuilderResourceAvailability({ core, request, logger });
      },
    },
    handler: async (toolParams, context) => {
      try {
        const { phase, results, query } = await diffMetricHandler({
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
        logger.error(`diff_metric tool failed: ${error.message}`);
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
