/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import type { ComposerQuery } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import { ALERTING_RULE_EXECUTOR_TASK_TYPE } from '../../rule_executor/constants';
import { DISPATCHER_TASK_TYPE } from '../../dispatcher/constants';
import { EVENT_LOG_INDEX } from './constants';
import type { ExecutionStatsResults } from './types';

const NS_PER_MS = 1000000;
export const nanosToMillis = (nanos?: number | null): number | null =>
  nanos != null ? Math.round(nanos / NS_PER_MS) : null;

const EVENT_LOG_PROVIDER = 'taskManager';
const EVENT_LOG_ACTION_TASK_RUN = 'task-run';
const MAX_STATUSES = 10;

type EsqlRow = Record<string, unknown>;

/** ES|QL fails on an index pattern without matches, where the DSL calls used `ignore_unavailable`. */
const isEsqlUnknownIndexError = (error: unknown): boolean => {
  const candidate = error as
    | { statusCode?: number; body?: { error?: { type?: string; reason?: string } } }
    | undefined;
  const reason = candidate?.body?.error?.reason;
  return (
    candidate?.statusCode === 400 &&
    candidate.body?.error?.type === 'verification_exception' &&
    typeof reason === 'string' &&
    reason.includes('Unknown index')
  );
};

const runEsqlRows = async (esClient: ElasticsearchClient, query: ComposerQuery) => {
  try {
    const response = await esClient.esql.query(query.toRequest() as unknown as EsqlQueryRequest);
    const names = response.columns.map((column) => column.name);
    return response.values.map(
      (row): EsqlRow => Object.fromEntries(names.map((name, index) => [name, row[index]]))
    );
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) {
      return [];
    }
    throw error;
  }
};

const taskRunsLast24h = (taskType: string) =>
  esql.from([EVENT_LOG_INDEX]).pipe`WHERE event.provider == ${{
    provider: EVENT_LOG_PROVIDER,
  }} AND event.action == ${{
    action: EVENT_LOG_ACTION_TASK_RUN,
  }} AND kibana.task.type == ${{ taskType }} AND @timestamp >= NOW() - 24 hours`;

const toNumberOrNull = (value: unknown): number | null =>
  typeof value === 'number' ? value : null;

export async function getExecutionStats(
  esClient: ElasticsearchClient
): Promise<ExecutionStatsResults> {
  const [[totals], statusRows, [dispatcher]] = await Promise.all([
    runEsqlRows(
      esClient,
      taskRunsLast24h(ALERTING_RULE_EXECUTOR_TASK_TYPE)
        .pipe`STATS total = COUNT(*), p50 = PERCENTILE(kibana.task.schedule_delay, 50), p75 = PERCENTILE(kibana.task.schedule_delay, 75), p95 = PERCENTILE(kibana.task.schedule_delay, 95), p99 = PERCENTILE(kibana.task.schedule_delay, 99)`
    ),
    runEsqlRows(
      esClient,
      taskRunsLast24h(ALERTING_RULE_EXECUTOR_TASK_TYPE)
        .pipe`STATS count = COUNT(*) BY outcome = event.outcome`.pipe`SORT count DESC`.limit(
        MAX_STATUSES
      )
    ),
    runEsqlRows(esClient, taskRunsLast24h(DISPATCHER_TASK_TYPE).pipe`STATS total = COUNT(*)`),
  ]);

  const executionsByStatus = statusRows.reduce<
    Partial<Record<'success' | 'failure' | 'unknown', number>>
  >((acc, { outcome, count }) => {
    if (typeof outcome === 'string' && typeof count === 'number') {
      acc[outcome as 'success' | 'failure' | 'unknown'] = count;
    }
    return acc;
  }, {});

  return {
    executions_count_24hr: toNumberOrNull(totals?.total) ?? 0,
    executions_count_by_status_24hr: executionsByStatus,
    executions_delay_p50_ms: nanosToMillis(toNumberOrNull(totals?.p50)),
    executions_delay_p75_ms: nanosToMillis(toNumberOrNull(totals?.p75)),
    executions_delay_p95_ms: nanosToMillis(toNumberOrNull(totals?.p95)),
    executions_delay_p99_ms: nanosToMillis(toNumberOrNull(totals?.p99)),
    dispatcher_executions_count_24hr: toNumberOrNull(dispatcher?.total) ?? 0,
  };
}
