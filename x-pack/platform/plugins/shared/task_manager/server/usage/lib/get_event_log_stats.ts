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
import { EVENT_LOG_ACTIONS, EVENT_LOG_PROVIDER } from '../../constants';
import { EVENT_LOG_INDEX, MAX_TASK_TYPE_BUCKETS } from '../constants';
import type { EventLogStatsResults } from './types';

const NS_PER_MS = 1000000;
const TELEMETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const nanosToMillis = (nanos?: number | null): number | null =>
  nanos != null ? Math.round(nanos / NS_PER_MS) : null;

interface EsqlRows {
  columns: Array<{ name: string }>;
  values: unknown[][];
}

/**
 * ES|QL reports a missing index as a 400 `verification_exception` ("Unknown index [<name>]"),
 * where the search used `ignore_unavailable`.
 */
const isEsqlUnknownIndexError = (error: unknown): boolean => {
  const { statusCode, body } = (error ?? {}) as {
    statusCode?: number;
    body?: { error?: { type?: string; reason?: string } };
  };
  return (
    statusCode === 400 &&
    body?.error?.type === 'verification_exception' &&
    typeof body.error.reason === 'string' &&
    body.error.reason.includes('Unknown index')
  );
};

const runEsql = async (
  esClient: ElasticsearchClient,
  query: ComposerQuery,
  signal: AbortSignal
): Promise<Array<Record<string, unknown>>> => {
  const { query: text, params } = query.toRequest();
  try {
    const { columns, values } = (await esClient.esql.query(
      { query: text, ...(params && params.length > 0 ? { params } : {}) } as EsqlQueryRequest,
      { signal }
    )) as unknown as EsqlRows;
    return values.map((row) =>
      Object.fromEntries(columns.map(({ name }, index) => [name, row[index]]))
    );
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) return [];
    throw error;
  }
};

const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/**
 * Aggregates cluster-wide task execution volume and schedule delay from the event log.
 *
 * `task-run-start` is used rather than `task-run` because it is emitted once per execution even
 * when the task never completes (crash, cancellation), which makes it the truer measure of how
 * many task runs were actually started.
 *
 * Both queries cover the same fixed window, so the by-type breakdown reconciles with the total.
 */
export async function getEventLogStats(
  esClient: ElasticsearchClient,
  signal: AbortSignal
): Promise<EventLogStatsResults> {
  const until = new Date();
  const params = {
    provider: EVENT_LOG_PROVIDER,
    action: EVENT_LOG_ACTIONS.taskRunStart,
    since: new Date(until.getTime() - TELEMETRY_WINDOW_MS).toISOString(),
    until: until.toISOString(),
  };
  const events = () =>
    esql.from([EVENT_LOG_INDEX]).pipe`WHERE event.provider == ${{ provider: params.provider }}
      AND event.action == ${{ action: params.action }}
      AND @timestamp >= TO_DATETIME(${{ since: params.since }})
      AND @timestamp <= TO_DATETIME(${{ until: params.until }})`;

  const [[totals], byType] = await Promise.all([
    runEsql(
      esClient,
      events()
        .pipe`STATS total = COUNT(*), typed = COUNT(kibana.task.type), p50 = PERCENTILE(kibana.task.schedule_delay, 50), p75 = PERCENTILE(kibana.task.schedule_delay, 75), p95 = PERCENTILE(kibana.task.schedule_delay, 95), p99 = PERCENTILE(kibana.task.schedule_delay, 99)`,
      signal
    ),
    runEsql(
      esClient,
      events().pipe`WHERE kibana.task.type IS NOT NULL`
        .pipe`STATS runs = COUNT(*) BY kibana.task.type`
        .pipe`SORT runs DESC, kibana.task.type ASC`.limit(MAX_TASK_TYPE_BUCKETS),
      signal
    ),
  ]);

  const taskRunsByType = byType.map((row) => ({
    name: String(row['kibana.task.type']),
    value: asNumber(row.runs) ?? 0,
  }));
  const typedRuns = asNumber(totals?.typed) ?? 0;
  const listedRuns = taskRunsByType.reduce((sum, { value }) => sum + value, 0);

  return {
    total_task_runs_24hr: asNumber(totals?.total) ?? 0,
    task_runs_by_type_24hr: taskRunsByType,
    // Kibana registers far more task types than MAX_TASK_TYPE_BUCKETS, so the breakdown can be
    // truncated. Reporting the remainder keeps it reconcilable against total_task_runs_24hr.
    task_runs_other_24hr: Math.max(0, typedRuns - listedRuns),
    schedule_delay_ms_24hr: {
      p50: nanosToMillis(asNumber(totals?.p50)),
      p75: nanosToMillis(asNumber(totals?.p75)),
      p95: nanosToMillis(asNumber(totals?.p95)),
      p99: nanosToMillis(asNumber(totals?.p99)),
    },
  };
}
