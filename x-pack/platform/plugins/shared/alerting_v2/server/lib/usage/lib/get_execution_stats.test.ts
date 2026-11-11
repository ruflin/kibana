/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { ALERTING_RULE_EXECUTOR_TASK_TYPE } from '../../rule_executor/constants';
import { DISPATCHER_TASK_TYPE } from '../../dispatcher/constants';
import { getExecutionStats, nanosToMillis } from './get_execution_stats';

const elasticsearch = elasticsearchServiceMock.createStart();
const esClient = elasticsearch.client.asInternalUser;

beforeEach(() => {
  jest.resetAllMocks();
});

describe('nanosToMillis', () => {
  test('should return 0 when passing 0 nanos', () => {
    expect(nanosToMillis(0)).toEqual(0);
  });

  test('should return 1 when passing 1000000 nanos', () => {
    expect(nanosToMillis(1000000)).toEqual(1);
  });

  test('should return null when passing null', () => {
    expect(nanosToMillis(null)).toEqual(null);
  });

  test('should return null when passing undefined', () => {
    expect(nanosToMillis(undefined)).toEqual(null);
  });

  test('should round to 1 when passing 750000 nanos (0.75ms)', () => {
    expect(nanosToMillis(750000)).toEqual(1);
  });
});

type EsqlRequest = { query: string; params: Array<Record<string, unknown>> };

const mockEsqlResponses = ({
  totals,
  statuses,
  dispatcher,
}: {
  totals: unknown[];
  statuses: Array<[string, number]>;
  dispatcher: number;
}) => {
  esClient.esql.query.mockImplementation((async (request: EsqlRequest) => {
    if (request.query.includes('PERCENTILE')) {
      return {
        columns: ['total', 'p50', 'p75', 'p95', 'p99'].map((name) => ({ name, type: 'double' })),
        values: [totals],
      };
    }
    if (request.query.includes('BY outcome')) {
      return {
        columns: [
          { name: 'count', type: 'long' },
          { name: 'outcome', type: 'keyword' },
        ],
        values: statuses.map(([outcome, count]) => [count, outcome]),
      };
    }
    return { columns: [{ name: 'total', type: 'long' }], values: [[dispatcher]] };
  }) as any);
};

describe('getExecutionStats', () => {
  it('returns stats from aggregations', async () => {
    mockEsqlResponses({
      totals: [150, 100000000, 250000000, 1200000000, 5000000000],
      statuses: [
        ['success', 140],
        ['failure', 10],
      ],
      dispatcher: 48,
    });

    const result = await getExecutionStats(esClient);

    expect(result).toEqual({
      executions_count_24hr: 150,
      executions_count_by_status_24hr: { success: 140, failure: 10 },
      executions_delay_p50_ms: 100,
      executions_delay_p75_ms: 250,
      executions_delay_p95_ms: 1200,
      executions_delay_p99_ms: 5000,
      dispatcher_executions_count_24hr: 48,
    });
  });

  it('queries the task-run events of the last 24 hours for the executor and the dispatcher', async () => {
    mockEsqlResponses({ totals: [0, null, null, null, null], statuses: [], dispatcher: 0 });

    await getExecutionStats(esClient);

    const requests = esClient.esql.query.mock.calls.map(([request]) => request as EsqlRequest);
    const taskRuns =
      'FROM .kibana-event-log-* | WHERE event.provider == ?provider AND event.action == ?action AND kibana.task.type == ?taskType AND @timestamp >= NOW() - 24 hours | ';
    expect(requests.map(({ query }) => query)).toEqual([
      `${taskRuns}STATS total = COUNT(*), p50 = PERCENTILE(kibana.task.schedule_delay, 50), p75 = PERCENTILE(kibana.task.schedule_delay, 75), p95 = PERCENTILE(kibana.task.schedule_delay, 95), p99 = PERCENTILE(kibana.task.schedule_delay, 99)`,
      `${taskRuns}STATS count = COUNT(*) BY outcome = event.outcome | SORT count DESC | LIMIT 10`,
      `${taskRuns}STATS total = COUNT(*)`,
    ]);
    expect(requests.map(({ params }) => params[2])).toEqual([
      { taskType: ALERTING_RULE_EXECUTOR_TASK_TYPE },
      { taskType: ALERTING_RULE_EXECUTOR_TASK_TYPE },
      { taskType: DISPATCHER_TASK_TYPE },
    ]);
  });

  it('returns defaults when aggregations are undefined', async () => {
    mockEsqlResponses({ totals: [0, null, null, null, null], statuses: [], dispatcher: 0 });

    const result = await getExecutionStats(esClient);

    expect(result).toEqual({
      executions_count_24hr: 0,
      executions_count_by_status_24hr: {},
      executions_delay_p50_ms: null,
      executions_delay_p75_ms: null,
      executions_delay_p95_ms: null,
      executions_delay_p99_ms: null,
      dispatcher_executions_count_24hr: 0,
    });
  });

  it('handles numeric hits.total format', async () => {
    mockEsqlResponses({ totals: [5, null, null, null, null], statuses: [], dispatcher: 2 });

    const result = await getExecutionStats(esClient);

    expect(result.executions_count_24hr).toBe(5);
    expect(result.dispatcher_executions_count_24hr).toBe(2);
  });

  it('returns defaults when the event log index does not exist', async () => {
    esClient.esql.query.mockRejectedValue({
      statusCode: 400,
      body: {
        error: { type: 'verification_exception', reason: 'Unknown index [.kibana-event-log-*]' },
      },
    });

    const result = await getExecutionStats(esClient);

    expect(result.executions_count_24hr).toBe(0);
    expect(result.dispatcher_executions_count_24hr).toBe(0);
  });
});
