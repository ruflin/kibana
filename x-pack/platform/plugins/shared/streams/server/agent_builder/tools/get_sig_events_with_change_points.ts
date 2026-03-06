/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
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

const getSigEventsWithChangePointsSchema = z.object({
  streamNames: z.array(z.string()).describe('Stream names to analyze'),
  from: z.string().default('now-1h').describe('Start time (e.g., "now-1h")'),
  to: z.string().default('now').describe('End time (e.g., "now")'),
});

export const GET_SIG_EVENTS_WITH_CHANGE_POINTS_TOOL_ID = `${internalNamespaces.streams}.get_sig_events_with_change_points`;

export const createGetSigEventsWithChangePointsTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof getSigEventsWithChangePointsSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof getSigEventsWithChangePointsSchema> = {
    id: GET_SIG_EVENTS_WITH_CHANGE_POINTS_TOOL_ID,
    type: ToolType.builtin,
    description: `Read sig events occurrences with change point analysis from the alerts index. Returns per-query: occurrence time series, change point type (spike/dip/step_change/trend_change), p-value, and timestamp.

This is the primary analysis tool — it identifies which queries show statistically significant changes.

When to use:
- Identifying which queries have significant changes (spikes, dips, trends)
- Starting an investigation by finding non-stationary patterns
- Getting statistical evidence for discoveries`,
    schema: getSigEventsWithChangePointsSchema,
    tags: ['streams', 'analysis', 'change-points'],
    handler: async (toolParams, { request, esClient }) => {
      try {
        const { readSignificantEventsFromAlertsIndices } = await import(
          '../../lib/significant_events/read_significant_events_from_alerts_indices'
        );
        const { QueryService } = await import('../../lib/streams/assets/query/query_service');

        const queryService = new QueryService(deps.core, deps.logger);
        const queryClient = await queryService.getClientWithRequest({ request });

        const from = parseRelativeTime(toolParams.from);
        const to = parseRelativeTime(toolParams.to);

        const results = await readSignificantEventsFromAlertsIndices(
          {
            streamNames: toolParams.streamNames,
            from,
            to,
            bucketSize: '5m',
          },
          {
            queryClient,
            scopedClusterClient: esClient,
          }
        );

        return {
          results: [
            {
              type: ToolResultType.other,
              data: { results },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to get sig events with change points: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
