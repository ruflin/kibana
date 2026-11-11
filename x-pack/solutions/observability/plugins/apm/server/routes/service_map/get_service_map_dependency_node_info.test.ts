/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ESQLSearchResponse } from '@kbn/es-types';
import { LatencyAggregationType } from '@kbn/apm-types';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import type { APMEventEsqlRequest } from '../../utils/esql_test_helpers';
import { esqlResponse, toEsqlRequest } from '../../utils/esql_test_helpers';
import { getServiceMapDependencyNodeInfo } from './get_service_map_dependency_node_info';

// withApmSpan is just a tracing wrapper: invoke the callback directly in tests.
jest.mock('../../utils/with_apm_span', () => ({
  withApmSpan: (_name: string, fn: () => Promise<unknown>) => fn(),
}));

// A 10 minute range, which the service map reads in 30 second buckets.
const start = 1_700_000_040_000;
const end = start + 10 * 60_000;
const intervalMs = 30_000;

const rollupColumns = [
  'doc_count',
  'latency_sum',
  'count',
  'successful_or_failed',
  'successful',
  'bucket',
];

function createClient(responses: Record<string, ESQLSearchResponse>) {
  const esql = jest.fn(async (operationName: string, _params?: APMEventEsqlRequest) => {
    return responses[operationName] ?? esqlResponse([], []);
  });
  return { esql, apmEventClient: { esql } as unknown as APMEventClient };
}

const baseOptions = {
  environment: 'production',
  dependencies: ['redis:6379', 'postgresql'],
  sourceServiceName: 'checkout',
  start,
  end,
};

describe('getServiceMapDependencyNodeInfo', () => {
  it('derives throughput, failed rate and latency from the summed buckets', async () => {
    const { esql, apmEventClient } = createClient({
      get_service_map_dependency_node_stats: esqlResponse(rollupColumns, [
        [2, 4_000, 20, 20, 15, start],
        [1, 2_000, 10, 10, 10, start + intervalMs],
      ]),
    });

    const { currentPeriod, previousPeriod } = await getServiceMapDependencyNodeInfo({
      ...baseOptions,
      apmEventClient,
    });

    expect(previousPeriod).toBeUndefined();
    // 30 spans in 10 minutes, 5 of 30 failed, 6000 / 30 average latency
    expect(currentPeriod.transactionStats?.throughput?.value).toBe(3);
    expect(currentPeriod.failedTransactionsRate?.value).toBeCloseTo(5 / 30);
    expect(currentPeriod.transactionStats?.latency?.value).toBe(200);
    // every bucket of the range has a point, buckets without documents have no value
    expect(currentPeriod.transactionStats?.latency?.timeseries).toHaveLength(21);
    expect(currentPeriod.transactionStats?.latency?.timeseries?.[0]).toEqual({ x: start, y: 200 });
    expect(currentPeriod.transactionStats?.latency?.timeseries?.[2]).toEqual({
      x: start + 2 * intervalMs,
      y: null,
    });
    expect(currentPeriod.failedTransactionsRate?.timeseries?.[2]).toEqual({
      x: start + 2 * intervalMs,
      y: null,
    });
    expect(toEsqlRequest(esql.mock.calls[0][1])).toMatchInlineSnapshot(`
      Object {
        "apm": Object {
          "events": Array [
            "metric",
          ],
        },
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "bool": Object {
                  "filter": Array [
                    Object {
                      "term": Object {
                        "metricset.name": "service_destination",
                      },
                    },
                  ],
                  "must_not": Array [
                    Object {
                      "terms": Object {
                        "metricset.interval": Array [
                          "10m",
                          "60m",
                        ],
                      },
                    },
                  ],
                },
              },
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000040000,
                    "lte": 1700000640000,
                  },
                },
              },
              Object {
                "bool": Object {
                  "minimum_should_match": 1,
                  "should": Array [
                    Object {
                      "term": Object {
                        "service.environment": "production",
                      },
                    },
                    Object {
                      "term": Object {
                        "resource.attributes.deployment.environment.name": "production",
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        "params": Array [
          Object {
            "dependencies": Array [
              "redis:6379",
              "postgresql",
            ],
          },
          Object {
            "sourceServiceName": "checkout",
          },
          Object {
            "intervalMs": 30000,
          },
          Object {
            "outcomes": Array [
              "failure",
              "success",
            ],
          },
          Object {
            "success": "success",
          },
        ],
        "query": "FROM myIndex | WHERE \`span.destination.service.resource\` IN (?dependencies) | WHERE \`service.name\` == ?sourceServiceName | EVAL bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ?intervalMs | STATS doc_count = COUNT(*), latency_sum = SUM(\`span.destination.service.response_time.sum.us\`), count = SUM(\`span.destination.service.response_time.count\`), successful_or_failed = COUNT(*) WHERE (\`event.outcome\` IN (?outcomes)), successful = COUNT(*) WHERE \`event.outcome\` == ?success BY bucket | LIMIT 21",
      }
    `);
  });

  it('returns no statistics when the dependencies have no calls', async () => {
    const { apmEventClient } = createClient({});

    const { currentPeriod } = await getServiceMapDependencyNodeInfo({
      ...baseOptions,
      apmEventClient,
    });

    expect(currentPeriod).toEqual({
      failedTransactionsRate: undefined,
      transactionStats: { throughput: undefined, latency: undefined },
    });
  });

  it('reads the p95 latency from the span documents, in total and per bucket', async () => {
    const { esql, apmEventClient } = createClient({
      get_service_map_dependency_node_stats: esqlResponse(rollupColumns, [
        [2, 4_000, 20, 20, 15, start],
      ]),
      get_service_map_dependency_node_stats_percentile: esqlResponse(['latency'], [[950]]),
      get_service_map_dependency_node_stats_percentile_timeseries: esqlResponse(
        ['latency', 'bucket'],
        [[900, start]]
      ),
    });

    const { currentPeriod } = await getServiceMapDependencyNodeInfo({
      ...baseOptions,
      latencyAggregationType: LatencyAggregationType.p95,
      apmEventClient,
    });

    expect(currentPeriod.transactionStats?.latency?.value).toBe(950);
    expect(currentPeriod.transactionStats?.latency?.timeseries?.[0]).toEqual({ x: start, y: 900 });
    expect(currentPeriod.transactionStats?.latency?.timeseries?.[1]).toEqual({
      x: start + intervalMs,
      y: null,
    });
    const percentileCall = esql.mock.calls.find(
      ([name]) => name === 'get_service_map_dependency_node_stats_percentile'
    );
    expect(percentileCall?.[1]?.apm).toEqual({ events: ['span'] });
    expect(toEsqlRequest(percentileCall?.[1]).query).toContain(
      'STATS latency = PERCENTILE(`span.duration.us`, ?percentile)'
    );
    expect(toEsqlRequest(percentileCall?.[1]).params).toEqual(
      expect.arrayContaining([{ percentile: 95 }])
    );
  });
});
