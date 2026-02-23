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
import { detectChangePointsHandler } from './handler';

export const OBSERVABILITY_DETECT_CHANGE_POINTS_TOOL_ID = 'observability.detect_change_points';

const detectChangePointsSchema = z.object({
  index: z.string().describe(indexDescription),
  timeField: z.string().default('@timestamp').describe('Timestamp field name.'),
  ...timeRangeSchemaRequired,
  metricField: z
    .string()
    .describe(
      'Numeric field to detect change points in. Examples: "system.cpu.total.pct", "http.response.latency".'
    ),
  byFields: z
    .array(z.string())
    .optional()
    .describe('Optional partition fields. Detects change points independently per partition.'),
  bucketSize: z
    .string()
    .default('1h')
    .describe('Time bucket size for aggregation. Examples: "5m", "1h", "1d".'),
  maxChanges: z.number().default(5).describe('Maximum number of change points to detect.'),
});

export function createDetectChangePointsTool({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): StaticToolRegistration<typeof detectChangePointsSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof detectChangePointsSchema> = {
    id: OBSERVABILITY_DETECT_CHANGE_POINTS_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      Detects multiple trend and step changes in a time series metric.

      Buckets the metric over time and uses a sliding window variance ratio test
      to find points where the metric behavior changes significantly.

      When to use:
      - Finding when a metric started degrading (latency increase, throughput drop)
      - Detecting multiple regime changes in a time series
      - Identifying the exact time an incident began or behavior shifted
      - Comparing change points across different services or hosts

      Do NOT use for:
      - Comparing two specific time windows (use diff_metric or diff_count)
      - Finding individual outlier values (use detect_outliers)
      - Analyzing categorical data changes (use diff_count)
    `,
    schema: detectChangePointsSchema,
    tags: ['observability', 'root-cause', 'change-point', 'time-series'],
    availability: {
      cacheMode: 'space',
      handler: async ({ request }) => {
        return getAgentBuilderResourceAvailability({ core, request, logger });
      },
    },
    handler: async (toolParams, context) => {
      try {
        const { phase, results, query } = await detectChangePointsHandler({
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
        logger.error(`detect_change_points tool failed: ${error.message}`);
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
