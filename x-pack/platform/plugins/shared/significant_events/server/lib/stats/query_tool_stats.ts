/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { ESQLSearchResponse } from '@kbn/es-types';
import { isEsqlUnknownIndexError } from '@kbn/storage-adapter';
import type {
  SignificantEventsStatsInterval,
  SignificantEventsStatsToolRow,
} from '../../../common/stats';
import {
  SIGNIFICANT_EVENTS_AGENT_ID_PREFIX,
  TOOL_TRACE_ID_LIMIT,
  buildAgentBuilderTracesIndexPattern,
} from './constants';
import { runEsqlQuery } from '../significant_events/run_esql_query';

export interface MappedToolStats {
  available: boolean;
  truncated: boolean;
  total: number;
  errors: number;
  daily: Array<{
    date: string;
    total: number;
    errors: number;
    byTool: Record<string, number>;
  }>;
  topTools: SignificantEventsStatsToolRow[];
}

const bucketIntervalLiteral = (interval: SignificantEventsStatsInterval): string =>
  interval === '1h' ? '1 hour' : '1 day';

const columnIndex = (columns: ESQLSearchResponse['columns'], name: string): number =>
  columns.findIndex((column) => column.name === name);

const readString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value ?? '');
};

const readNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 0;
};

export const queryToolStats = async ({
  esClient,
  spaceId,
  from,
  to,
  interval,
  tracingEnabled,
}: {
  esClient: ElasticsearchClient;
  spaceId: string;
  from: string;
  to: string;
  interval: SignificantEventsStatsInterval;
  tracingEnabled: boolean;
}): Promise<MappedToolStats> => {
  if (!tracingEnabled) {
    return {
      available: false,
      truncated: false,
      total: 0,
      errors: 0,
      daily: [],
      topTools: [],
    };
  }

  const index = buildAgentBuilderTracesIndexPattern(spaceId);

  try {
    const traceIdsResponse = await runEsqlQuery(
      esClient,
      `FROM ${index}
| WHERE @timestamp >= "${from}" AND @timestamp < "${to}"
| WHERE span.name LIKE "invoke_agent *"
  AND attributes.elastic.inference.span.kind == "AGENT"
  AND attributes.gen_ai.agent.id LIKE "${SIGNIFICANT_EVENTS_AGENT_ID_PREFIX}*"
| KEEP trace.id
| LIMIT ${TOOL_TRACE_ID_LIMIT}`
    );

    if (!traceIdsResponse) {
      return {
        available: false,
        truncated: false,
        total: 0,
        errors: 0,
        daily: [],
        topTools: [],
      };
    }

    const traceIdCol = columnIndex(traceIdsResponse.columns, 'trace.id');
    const traceIds = Array.from(
      new Set(
        (traceIdsResponse.values ?? [])
          .map((row) => (traceIdCol >= 0 ? readString(row[traceIdCol]) : ''))
          .filter((id) => id.length > 0)
      )
    );

    const truncated = (traceIdsResponse.values?.length ?? 0) >= TOOL_TRACE_ID_LIMIT;

    if (traceIds.length === 0) {
      return {
        available: true,
        truncated,
        total: 0,
        errors: 0,
        daily: [],
        topTools: [],
      };
    }

    // ES|QL IN lists are bounded by the TRACE_ID_LIMIT above.
    const inList = traceIds.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(', ');
    const toolsResponse = await runEsqlQuery(
      esClient,
      `FROM ${index}
| WHERE @timestamp >= "${from}" AND @timestamp < "${to}"
| WHERE span.name LIKE "execute_tool *"
| WHERE trace.id IN (${inList})
| EVAL tool_id = COALESCE(attributes.gen_ai.tool.name, name)
| STATS calls = COUNT(*),
        errors = COUNT(*) WHERE status.code == "Error"
    BY day = BUCKET(@timestamp, ${bucketIntervalLiteral(interval)}), tool_id
| SORT day, calls DESC`
    );

    if (!toolsResponse) {
      return {
        available: false,
        truncated,
        total: 0,
        errors: 0,
        daily: [],
        topTools: [],
      };
    }

    const dayCol = columnIndex(toolsResponse.columns, 'day');
    const toolCol = columnIndex(toolsResponse.columns, 'tool_id');
    const callsCol = columnIndex(toolsResponse.columns, 'calls');
    const errorsCol = columnIndex(toolsResponse.columns, 'errors');

    const dailyByDate = new Map<
      string,
      { total: number; errors: number; byTool: Record<string, number> }
    >();
    const toolTotals = new Map<string, { calls: number; errors: number }>();

    for (const row of toolsResponse.values ?? []) {
      const date = readString(row[dayCol]);
      const toolId = readString(row[toolCol]) || 'unknown';
      const calls = readNumber(row[callsCol]);
      const errors = readNumber(row[errorsCol]);

      const day = dailyByDate.get(date) ?? { total: 0, errors: 0, byTool: {} };
      day.total += calls;
      day.errors += errors;
      day.byTool[toolId] = (day.byTool[toolId] ?? 0) + calls;
      dailyByDate.set(date, day);

      const tool = toolTotals.get(toolId) ?? { calls: 0, errors: 0 };
      tool.calls += calls;
      tool.errors += errors;
      toolTotals.set(toolId, tool);
    }

    const daily = Array.from(dailyByDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, ...value }));

    let total = 0;
    let errors = 0;
    for (const day of daily) {
      total += day.total;
      errors += day.errors;
    }

    const topTools = Array.from(toolTotals.entries())
      .map(([toolId, value]) => ({ toolId, calls: value.calls, errors: value.errors }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 15);

    return {
      available: true,
      truncated,
      total,
      errors,
      daily,
      topTools,
    };
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) {
      return {
        available: false,
        truncated: false,
        total: 0,
        errors: 0,
        daily: [],
        topTools: [],
      };
    }
    throw error;
  }
};
