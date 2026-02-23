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
import { detectOutliersHandler } from './handler';

export const OBSERVABILITY_DETECT_OUTLIERS_TOOL_ID = 'observability.detect_outliers';

const detectOutliersSchema = z.object({
  index: z.string().describe(indexDescription),
  timeField: z
    .string()
    .optional()
    .describe(
      'Timestamp field. If provided, enables time-aware baseline construction for spike/dip detection.'
    ),
  ...timeRangeSchemaRequired,
  metricField: z
    .string()
    .describe(
      'Numeric field to check for outliers. Examples: "system.cpu.total.pct", "http.response.bytes".'
    ),
  byFields: z
    .array(z.string())
    .optional()
    .describe(
      'Partition fields for population analysis. Example: ["host.name"] to find outlier hosts.'
    ),
  direction: z
    .enum(['both', 'incr', 'decr'])
    .default('both')
    .describe('"incr" for spikes only, "decr" for dips only, "both" for either.'),
  scoreThreshold: z
    .number()
    .default(2.0)
    .describe('Minimum outlier score (z-score). 2.0 ≈ p < 0.05, 3.0 ≈ p < 0.003.'),
  preAggregation: z
    .string()
    .optional()
    .describe(
      dedent`Optional ES|QL aggregation to apply before outlier detection.
        Example: "STATS vol = SUM(RATE(requests)) BY BUCKET(@timestamp, 1 hour), host.name"
        This pre-aggregates data before looking for outliers in the aggregated values.`
    ),
  limit: z.number().default(10).describe('Maximum number of outliers to return.'),
});

export function createDetectOutliersTool({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): StaticToolRegistration<typeof detectOutliersSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof detectOutliersSchema> = {
    id: OBSERVABILITY_DETECT_OUTLIERS_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      Finds outlier values in a metric, either across time (spike/dip detection) or
      across a population (which entities are unusual compared to peers).

      Uses z-score based outlier detection with optional time-aware baselines.

      When to use:
      - Finding which hosts have unusually high CPU, memory, or network usage
      - Detecting request rate spikes for specific services or endpoints
      - Population analysis: comparing entities against their peers
      - Peer group analysis when combined with pre-aggregation

      Examples:
      - Find hosts with highest request rate in any hour:
          metricField: "request_count", preAggregation: "STATS vol = COUNT(*) BY BUCKET(@timestamp, 1 hour), host.name"
      - Find services with outlier error rates:
          metricField: "error.count", byFields: ["service.name"]

      Do NOT use for:
      - Comparing distributions between two time windows (use diff_metric)
      - Comparing categorical count distributions (use diff_count)
      - Finding trend changes over time (use detect_change_points)
    `,
    schema: detectOutliersSchema,
    tags: ['observability', 'root-cause', 'outlier', 'anomaly'],
    availability: {
      cacheMode: 'space',
      handler: async ({ request }) => {
        return getAgentBuilderResourceAvailability({ core, request, logger });
      },
    },
    handler: async (toolParams, context) => {
      try {
        const { phase, results, query } = await detectOutliersHandler({
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
        logger.error(`detect_outliers tool failed: ${error.message}`);
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
