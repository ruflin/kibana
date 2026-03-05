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
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type { StreamsToolsDependencies } from './types';

const TIME_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

const parseRelativeTime = (value: string): Date => {
  if (value === 'now') {
    return new Date();
  }
  const match = value.match(/^now-(\d+)([smhdw])$/);
  if (match) {
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    return new Date(Date.now() - amount * (TIME_UNIT_MS[unit] ?? 0));
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid time value: ${value}`);
  }
  return parsed;
};

const runLogRateAnalysisSchema = z.object({
  streamName: z.string().describe('Stream name to analyze'),
  baselineFrom: z.string().describe('Baseline window start (e.g., "now-2h")'),
  baselineTo: z.string().describe('Baseline window end (e.g., "now-1h")'),
  deviationFrom: z.string().describe('Deviation window start (e.g., "now-1h")'),
  deviationTo: z.string().describe('Deviation window end (e.g., "now")'),
  field: z.string().optional().describe('Optional field to focus analysis on'),
});

export const RUN_LOG_RATE_ANALYSIS_TOOL_ID = `${internalNamespaces.streams}.run_log_rate_analysis`;

export const createRunLogRateAnalysisTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof runLogRateAnalysisSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof runLogRateAnalysisSchema> = {
    id: RUN_LOG_RATE_ANALYSIS_TOOL_ID,
    type: ToolType.builtin,
    description: `Compare a baseline time window against a deviation window to identify which field/value combinations correlate with throughput changes. Returns significant items with change ratios. Helps identify root causes of spikes or dips.

When to use:
- Investigating why log volume spiked or dropped
- Finding which field values changed between two time periods
- Identifying root causes of throughput anomalies
- Comparing normal vs abnormal time windows`,
    schema: runLogRateAnalysisSchema,
    tags: ['streams', 'analysis', 'log-rate'],
    handler: async (toolParams, { request }) => {
      try {
        const esClient = (await deps.getEsClient(request)).asCurrentUser;
        const baselineFrom = parseRelativeTime(toolParams.baselineFrom);
        const baselineTo = parseRelativeTime(toolParams.baselineTo);
        const deviationFrom = parseRelativeTime(toolParams.deviationFrom);
        const deviationTo = parseRelativeTime(toolParams.deviationTo);

        const [baselineResult, deviationResult] = await Promise.all([
          esClient.search({
            index: toolParams.streamName,
            size: 0,
            query: {
              bool: {
                filter: [
                  {
                    range: {
                      '@timestamp': {
                        gte: baselineFrom.toISOString(),
                        lte: baselineTo.toISOString(),
                      },
                    },
                  },
                ],
              },
            },
            aggs: {
              total: { value_count: { field: '@timestamp' } },
              ...(toolParams.field
                ? { field_breakdown: { terms: { field: toolParams.field, size: 50 } } }
                : {
                    field_breakdown: {
                      significant_terms: { field: 'message.keyword', size: 20 },
                    },
                  }),
            },
          }),
          esClient.search({
            index: toolParams.streamName,
            size: 0,
            query: {
              bool: {
                filter: [
                  {
                    range: {
                      '@timestamp': {
                        gte: deviationFrom.toISOString(),
                        lte: deviationTo.toISOString(),
                      },
                    },
                  },
                ],
              },
            },
            aggs: {
              total: { value_count: { field: '@timestamp' } },
              ...(toolParams.field
                ? { field_breakdown: { terms: { field: toolParams.field, size: 50 } } }
                : {
                    field_breakdown: {
                      significant_terms: { field: 'message.keyword', size: 20 },
                    },
                  }),
            },
          }),
        ]);

        const baselineTotal =
          (baselineResult.aggregations?.total as { value?: number })?.value ?? 0;
        const deviationTotal =
          (deviationResult.aggregations?.total as { value?: number })?.value ?? 0;

        const baselineBuckets =
          (
            baselineResult.aggregations?.field_breakdown as {
              buckets?: Array<{ key: string; doc_count: number }>;
            }
          )?.buckets ?? [];
        const deviationBuckets =
          (
            deviationResult.aggregations?.field_breakdown as {
              buckets?: Array<{ key: string; doc_count: number }>;
            }
          )?.buckets ?? [];

        const baselineMap = new Map(baselineBuckets.map((b) => [b.key, b.doc_count]));
        const significantChanges = deviationBuckets
          .map((b) => {
            const baselineCount = baselineMap.get(b.key) ?? 0;
            const change =
              baselineCount > 0
                ? (b.doc_count - baselineCount) / baselineCount
                : b.doc_count > 0
                ? Infinity
                : 0;
            return {
              field_value: b.key,
              baseline_count: baselineCount,
              deviation_count: b.doc_count,
              change_ratio: change,
            };
          })
          .filter((item) => Math.abs(item.change_ratio) > 0.1)
          .sort((a, b) => Math.abs(b.change_ratio) - Math.abs(a.change_ratio))
          .slice(0, 20);

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                streamName: toolParams.streamName,
                baseline_total: baselineTotal,
                deviation_total: deviationTotal,
                rate_change:
                  baselineTotal > 0 ? (deviationTotal - baselineTotal) / baselineTotal : 0,
                significant_changes: significantChanges,
              },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to run log rate analysis: ${error instanceof Error ? error.message : String(error)}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
