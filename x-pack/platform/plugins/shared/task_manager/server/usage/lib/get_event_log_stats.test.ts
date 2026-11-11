/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { getEventLogStats, nanosToMillis } from './get_event_log_stats';
import { MAX_TASK_TYPE_BUCKETS } from '../constants';

const elasticsearch = elasticsearchServiceMock.createStart();
const esClient = elasticsearch.client.asInternalUser;
const signal = new AbortController().signal;

const TOTALS_COLUMNS = ['total', 'typed', 'p50', 'p75', 'p95', 'p99'].map((name) => ({
  name,
  type: 'double',
}));
const BY_TYPE_COLUMNS = [
  { name: 'runs', type: 'long' },
  { name: 'kibana.task.type', type: 'keyword' },
];

type EsqlResponse = Awaited<ReturnType<typeof esClient.esql.query>>;

/** Answers the totals query and the by-type query, which run in parallel. */
const mockEsql = ({
  totals = [0, 0, null, null, null, null],
  byType = [],
}: {
  totals?: Array<number | null>;
  byType?: Array<[number, string]>;
}) => {
  esClient.esql.query.mockImplementation((async (request: { query: string }) =>
    request.query.includes('BY kibana.task.type')
      ? { columns: BY_TYPE_COLUMNS, values: byType }
      : { columns: TOTALS_COLUMNS, values: [totals] }) as unknown as () => Promise<EsqlResponse>);
};

const requestedQueries = () =>
  esClient.esql.query.mock.calls.map(([request]) => request as { query: string; params: unknown });

beforeEach(() => {
  jest.resetAllMocks();
});

describe('nanosToMillis', () => {
  test('returns 0 when passing 0 nanos', () => {
    expect(nanosToMillis(0)).toEqual(0);
  });

  test('converts 1000000 nanos to 1ms', () => {
    expect(nanosToMillis(1000000)).toEqual(1);
  });

  test('rounds 750000 nanos (0.75ms) to 1ms', () => {
    expect(nanosToMillis(750000)).toEqual(1);
  });

  test('returns null when passing null', () => {
    expect(nanosToMillis(null)).toEqual(null);
  });

  test('returns null when passing undefined', () => {
    expect(nanosToMillis(undefined)).toEqual(null);
  });
});

describe('getEventLogStats', () => {
  it('queries the event log for task-run-start events in the last 24h', async () => {
    mockEsql({});

    await getEventLogStats(esClient, signal);

    const [totalsRequest, byTypeRequest] = requestedQueries();
    expect(totalsRequest.query).toContain('FROM .kibana-event-log-*');
    expect(totalsRequest.query).toContain(
      'WHERE event.provider == ?provider AND event.action == ?action AND @timestamp >= TO_DATETIME(?since) AND @timestamp <= TO_DATETIME(?until)'
    );
    expect(totalsRequest.query).toContain(
      'STATS total = COUNT(*), typed = COUNT(kibana.task.type), p50 = PERCENTILE(kibana.task.schedule_delay, 50), p75 = PERCENTILE(kibana.task.schedule_delay, 75), p95 = PERCENTILE(kibana.task.schedule_delay, 95), p99 = PERCENTILE(kibana.task.schedule_delay, 99)'
    );
    expect(byTypeRequest.query).toContain('STATS runs = COUNT(*) BY kibana.task.type');
    expect(byTypeRequest.query).toContain(`LIMIT ${MAX_TASK_TYPE_BUCKETS}`);

    const { provider, action, since, until } = Object.assign(
      {},
      ...(totalsRequest.params as Array<Record<string, string>>)
    );
    expect(provider).toBe('taskManager');
    expect(action).toBe('task-run-start');
    expect(new Date(until).getTime() - new Date(since).getTime()).toBe(24 * 60 * 60 * 1000);
    // both queries cover the same window, so the breakdown reconciles with the total
    expect(byTypeRequest.params).toEqual(totalsRequest.params);
  });

  it("forwards the task's abort signal so a timeout cancels the aggregation", async () => {
    const abortController = new AbortController();
    mockEsql({});

    await getEventLogStats(esClient, abortController.signal);

    expect(esClient.esql.query).toHaveBeenCalledTimes(2);
    esClient.esql.query.mock.calls.forEach(([, options]) =>
      expect(options).toEqual({ signal: abortController.signal })
    );
  });

  it('returns totals, by-type counts and delay percentiles converted to ms', async () => {
    mockEsql({
      totals: [150, 150, 100000000, 250000000, 1200000000, 5000000000],
      byType: [
        [100, 'alerting:.index-threshold'],
        [50, 'actions:.server-log'],
      ],
    });

    const result = await getEventLogStats(esClient, signal);

    expect(result).toEqual({
      total_task_runs_24hr: 150,
      task_runs_by_type_24hr: [
        { name: 'alerting:.index-threshold', value: 100 },
        { name: 'actions:.server-log', value: 50 },
      ],
      task_runs_other_24hr: 0,
      schedule_delay_ms_24hr: { p50: 100, p75: 250, p95: 1200, p99: 5000 },
    });
  });

  it('reports the runs excluded from a truncated by-type breakdown', async () => {
    mockEsql({
      totals: [500, 500, null, null, null, null],
      byType: [[300, 'alerting:.index-threshold']],
    });

    const result = await getEventLogStats(esClient, signal);

    expect(result.task_runs_other_24hr).toBe(200);
    // The breakdown plus the remainder must always reconcile against the reported total.
    const breakdownTotal = result.task_runs_by_type_24hr!.reduce(
      (sum, { value }) => sum + value,
      0
    );
    expect(breakdownTotal + result.task_runs_other_24hr!).toBe(result.total_task_runs_24hr);
  });

  it('does not count runs without a task type as truncated runs', async () => {
    mockEsql({
      totals: [10, 8, null, null, null, null],
      byType: [[8, 'alerting:.index-threshold']],
    });

    const result = await getEventLogStats(esClient, signal);

    expect(result.task_runs_other_24hr).toBe(0);
  });

  it('returns defaults when the event log has no matching events', async () => {
    mockEsql({});

    const result = await getEventLogStats(esClient, signal);

    expect(result).toEqual({
      total_task_runs_24hr: 0,
      task_runs_by_type_24hr: [],
      task_runs_other_24hr: 0,
      schedule_delay_ms_24hr: { p50: null, p75: null, p95: null, p99: null },
    });
  });

  it('returns null percentiles when the event log has no schedule_delay values', async () => {
    mockEsql({
      totals: [3, 3, null, null, null, null],
      byType: [[3, 'task_manager:snapshot_telemetry']],
    });

    const result = await getEventLogStats(esClient, signal);

    expect(result.total_task_runs_24hr).toBe(3);
    expect(result.schedule_delay_ms_24hr).toEqual({ p50: null, p75: null, p95: null, p99: null });
  });

  it('returns defaults when the event log index does not exist', async () => {
    esClient.esql.query.mockRejectedValue(
      new errors.ResponseError({
        statusCode: 400,
        body: {
          error: { type: 'verification_exception', reason: 'Found 1 problem\nUnknown index [x]' },
        },
        headers: {},
        warnings: [],
        meta: {} as never,
      })
    );

    const result = await getEventLogStats(esClient, signal);

    expect(result.total_task_runs_24hr).toBe(0);
    expect(result.task_runs_by_type_24hr).toEqual([]);
  });

  it('propagates elasticsearch errors to the caller', async () => {
    esClient.esql.query.mockRejectedValue(new Error('index_not_found_exception'));

    await expect(getEventLogStats(esClient, signal)).rejects.toThrow('index_not_found_exception');
  });
});
