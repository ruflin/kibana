/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ESQLSearchResponse } from '@kbn/es-types';
import type { APMEventClient } from '@kbn/apm-data-access-plugin/server';
import type { APMEventEsqlRequest } from '../../utils/esql_test_helpers';
import { esqlResponse, toEsqlRequest } from '../../utils/esql_test_helpers';
import { BUCKET_TARGET_COUNT } from '../transactions/constants';
import { getMobileCrashRate } from './get_mobile_crash_rate';
import { getMobileAvgLaunchTime } from './get_mobile_average_launch_time';
import { getMobileHttpRequests } from './get_mobile_http_requests';
import { getMobileSessions } from './get_mobile_sessions';
import { getMobileTermsByField } from './get_mobile_terms_by_field';
import { getMobileErrorsTermsByField } from './errors/get_mobile_errors_terms_by_field';
import { getMobileMainStatisticsByField } from './get_mobile_main_statistics_by_field';
import { getMobileDetailedStatisticsByFieldPeriods } from './get_mobile_detailed_statistics_by_field';
import { getMobileHttpErrors } from './errors/get_mobile_http_errors';
import { getMobileCrashesGroupPeriods } from './crashes/get_mobile_crash_group_detailed_statistics';
import { getMobileErrorGroupPeriods } from './errors/get_mobile_error_group_detailed_statistics';

// 20 minutes in one-minute buckets (the minimum bucket size of the mobile charts).
const start = 1_700_000_040_000;
const end = start + 20 * 60_000;
const bucketKeys = Array.from({ length: 21 }, (_, i) => 1_700_000_040_000 + i * 60_000);

/** A client whose `esql` answers by operation name, in order. */
function createClient(responses: Record<string, ESQLSearchResponse[]> = {}) {
  const esql = jest.fn(async (operationName: string, _params?: APMEventEsqlRequest) => {
    return responses[operationName]?.shift() ?? esqlResponse([], []);
  });
  return { esql, apmEventClient: { esql } as unknown as APMEventClient };
}

const requestOf = (esql: jest.Mock, operationName: string) => {
  const call = esql.mock.calls.find(([name]) => name === operationName);
  const { query, params, filter } = toEsqlRequest(call?.[1]);
  return { query, params, filter };
};

const common = {
  serviceName: 'svc',
  environment: 'production',
  kuery: 'service.version: "1"',
  start,
  end,
};

describe('mobile timeseries', () => {
  it('counts the distinct crashes per bucket and in total, filling empty buckets', async () => {
    const { esql, apmEventClient } = createClient({
      get_mobile_crash_rate: [esqlResponse(['crashes', 'bucket'], [[3, bucketKeys[1]]])],
      get_mobile_crash_rate_total: [esqlResponse(['crashes'], [[3]])],
    });

    const result = await getMobileCrashRate({ ...common, apmEventClient });

    expect(result.currentPeriod.value).toBe(3);
    expect(result.currentPeriod.timeseries).toHaveLength(bucketKeys.length);
    expect(result.currentPeriod.timeseries.slice(0, 3)).toEqual([
      { x: bucketKeys[0], y: 0 },
      { x: bucketKeys[1], y: 3 },
      { x: bucketKeys[2], y: 0 },
    ]);
    expect(requestOf(esql, 'get_mobile_crash_rate')).toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000040000,
                    "lte": 1700001240000,
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
              Object {
                "bool": Object {
                  "minimum_should_match": 1,
                  "should": Array [
                    Object {
                      "match_phrase": Object {
                        "service.version": "1",
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
            "errorType": "crash",
          },
          Object {
            "serviceName": "svc",
          },
          Object {
            "intervalMs": 60000,
          },
        ],
        "query": "FROM myIndex | WHERE \`error.type\` == ?errorType | WHERE \`service.name\` == ?serviceName | EVAL bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ?intervalMs | STATS crashes = COUNT_DISTINCT(\`error.id\`) BY bucket | LIMIT 21",
      }
    `);
    expect(requestOf(esql, 'get_mobile_crash_rate_total').query).toContain(
      'STATS crashes = COUNT_DISTINCT(`error.id`)'
    );
  });

  it('averages the launch time per bucket, leaving empty buckets null', async () => {
    const { esql, apmEventClient } = createClient({
      get_mobile_launch_time: [esqlResponse(['launchTimeAvg', 'bucket'], [[120.5, bucketKeys[0]]])],
      get_mobile_launch_time_total: [esqlResponse(['launchTimeAvg'], [[120.5]])],
    });

    const result = await getMobileAvgLaunchTime({ ...common, apmEventClient });

    expect(result.currentPeriod.value).toBe(120.5);
    expect(result.currentPeriod.timeseries.slice(0, 2)).toEqual([
      { x: bucketKeys[0], y: 120.5 },
      { x: bucketKeys[1], y: null },
    ]);
    expect(requestOf(esql, 'get_mobile_launch_time')).toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000040000,
                    "lte": 1700001240000,
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
              Object {
                "bool": Object {
                  "minimum_should_match": 1,
                  "should": Array [
                    Object {
                      "match_phrase": Object {
                        "service.version": "1",
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
            "service_name_value": "svc",
          },
          Object {
            "intervalMs": 60000,
          },
        ],
        "query": "SET unmapped_fields = \\"nullify\\"; FROM myIndex | WHERE \`service.name\` == ?service_name_value | EVAL bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ?intervalMs | STATS launchTimeAvg = AVG(\`application.launch.time\`) BY bucket | LIMIT 21",
      }
    `);
  });

  it('counts the HTTP requests of the external spans per bucket and in total', async () => {
    const { esql, apmEventClient } = createClient({
      get_http_requests_chart: [esqlResponse(['requests', 'bucket'], [[7, bucketKeys[2]]])],
      get_http_requests_chart_total: [esqlResponse(['requests'], [[7]])],
    });

    const result = await getMobileHttpRequests({
      ...common,
      transactionName: 'Launch',
      apmEventClient,
    });

    expect(result.currentPeriod.value).toBe(7);
    expect(result.currentPeriod.timeseries[2]).toEqual({ x: bucketKeys[2], y: 7 });
    expect(requestOf(esql, 'get_http_requests_chart')).toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000040000,
                    "lte": 1700001240000,
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
              Object {
                "bool": Object {
                  "minimum_should_match": 1,
                  "should": Array [
                    Object {
                      "match_phrase": Object {
                        "service.version": "1",
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
            "span_type_value": "external",
          },
          Object {
            "service_name_value": "svc",
          },
          Object {
            "transaction_name_value": "Launch",
          },
          Object {
            "intervalMs": 60000,
          },
          Object {
            "spanSubtype": "http",
          },
        ],
        "query": "SET unmapped_fields = \\"nullify\\"; FROM myIndex | WHERE \`span.type\` == ?span_type_value | WHERE \`service.name\` == ?service_name_value | WHERE \`transaction.name\` == ?transaction_name_value | EVAL bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ?intervalMs | STATS requests = COUNT(*) WHERE \`span.subtype\` == ?spanSubtype BY bucket | LIMIT 21",
      }
    `);
  });

  it('counts the distinct sessions per bucket and in total', async () => {
    const { esql, apmEventClient } = createClient({
      get_mobile_sessions: [esqlResponse(['sessions', 'bucket'], [[5, bucketKeys[0]]])],
      get_mobile_sessions_total: [esqlResponse(['sessions'], [[5]])],
    });

    const result = await getMobileSessions({ ...common, apmEventClient });

    expect(result.currentPeriod.value).toBe(5);
    expect(result.currentPeriod.timeseries[0]).toEqual({ x: bucketKeys[0], y: 5 });
    expect(requestOf(esql, 'get_mobile_sessions')).toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000040000,
                    "lte": 1700001240000,
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
              Object {
                "bool": Object {
                  "minimum_should_match": 1,
                  "should": Array [
                    Object {
                      "match_phrase": Object {
                        "service.version": "1",
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
            "service_name_value": "svc",
          },
          Object {
            "intervalMs": 60000,
          },
        ],
        "query": "FROM myIndex | WHERE \`service.name\` == ?service_name_value | WHERE \`session.id\` IS NOT NULL | EVAL bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ?intervalMs | STATS sessions = COUNT_DISTINCT(\`session.id\`) BY bucket | LIMIT 21",
      }
    `);
  });

  it('counts the HTTP errors (400 to 599, not crashes) per bucket', async () => {
    // The buckets of this chart are the range divided by the target bucket count, epoch aligned.
    const intervalMs = Math.floor((end - start) / BUCKET_TARGET_COUNT);
    const firstBucket = Math.floor(start / intervalMs) * intervalMs;
    const { esql, apmEventClient } = createClient({
      get_mobile_http_errors: [esqlResponse(['doc_count', 'bucket'], [[2, firstBucket]])],
    });

    const result = await getMobileHttpErrors({
      serviceName: 'svc',
      environment: 'production',
      kuery: '',
      start,
      end,
      apmEventClient,
    });

    expect(result.currentPeriod.timeseries[0]).toEqual({ x: firstBucket, y: 2 });
    expect(requestOf(esql, 'get_mobile_http_errors')).toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
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
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000040000,
                    "lte": 1700001240000,
                  },
                },
              },
            ],
            "must_not": Array [
              Object {
                "term": Object {
                  "error.type": "crash",
                },
              },
            ],
          },
        },
        "params": Array [
          Object {
            "service_name_value": "svc",
          },
          Object {
            "minStatusCode": 400,
          },
          Object {
            "maxStatusCode": 599,
          },
          Object {
            "intervalMs": 80000,
          },
        ],
        "query": "SET unmapped_fields = \\"nullify\\"; FROM myIndex | WHERE \`service.name\` == ?service_name_value | WHERE \`http.response.status_code\` >= ?minStatusCode AND \`http.response.status_code\` <= ?maxStatusCode | EVAL bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ?intervalMs | STATS doc_count = COUNT(*) BY bucket | LIMIT 16",
      }
    `);
  });
});

describe('mobile terms by field', () => {
  const fieldName = 'device.model.identifier';
  const termsParams = { ...common, size: 5, fieldName };
  const termsResponse = esqlResponse(
    ['doc_count', fieldName],
    [
      [9, 'pixel'],
      [4, 'iphone'],
    ]
  );

  it('lists the top values of a transaction field', async () => {
    const { esql, apmEventClient } = createClient({
      [`get_mobile_terms_by_${fieldName}`]: [termsResponse],
    });

    const result = await getMobileTermsByField({ ...termsParams, apmEventClient });

    expect(result).toEqual([
      { label: 'pixel', count: 9 },
      { label: 'iphone', count: 4 },
    ]);
    expect(requestOf(esql, `get_mobile_terms_by_${fieldName}`)).toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000040000,
                    "lte": 1700001240000,
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
              Object {
                "bool": Object {
                  "minimum_should_match": 1,
                  "should": Array [
                    Object {
                      "match_phrase": Object {
                        "service.version": "1",
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
            "service_name_value": "svc",
          },
        ],
        "query": "SET unmapped_fields = \\"nullify\\"; FROM myIndex | WHERE \`service.name\` == ?service_name_value | WHERE \`device.model.identifier\` IS NOT NULL | STATS doc_count = COUNT(*) BY \`device.model.identifier\` | SORT doc_count DESC, \`device.model.identifier\` ASC | LIMIT 5",
      }
    `);
  });

  it('lists the top values of an error field', async () => {
    const { esql, apmEventClient } = createClient({
      [`get_mobile_terms_by_${fieldName}`]: [termsResponse],
    });

    const result = await getMobileErrorsTermsByField({ ...termsParams, apmEventClient });

    expect(result).toEqual([
      { label: 'pixel', count: 9 },
      { label: 'iphone', count: 4 },
    ]);
    expect(esql.mock.calls[0]?.[1]?.apm).toEqual({ events: ['error'] });
  });
});

describe('mobile statistics by field', () => {
  const field = 'device.model.identifier';

  it('merges the transaction statistics with the crash counts of each value', async () => {
    const { esql, apmEventClient } = createClient({
      get_mobile_transaction_events_main_statistics_by_field: [
        esqlResponse(['doc_count', 'latency', 'sessions', field], [[20, 1500, 10, 'pixel']]),
      ],
      get_mobile_crashes: [esqlResponse(['doc_count', 'crashes', field], [[3, 2, 'pixel']])],
    });

    const result = await getMobileMainStatisticsByField({ ...common, field, apmEventClient });

    expect(result.mainStatistics).toEqual([
      { name: 'pixel', latency: 1500, throughput: 1, crashRate: 0.2 },
    ]);
    expect(requestOf(esql, 'get_mobile_transaction_events_main_statistics_by_field'))
      .toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000040000,
                    "lte": 1700001240000,
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
              Object {
                "bool": Object {
                  "minimum_should_match": 1,
                  "should": Array [
                    Object {
                      "match_phrase": Object {
                        "service.version": "1",
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
            "service_name_value": "svc",
          },
        ],
        "query": "SET unmapped_fields = \\"nullify\\"; FROM myIndex | WHERE \`service.name\` == ?service_name_value | WHERE \`device.model.identifier\` IS NOT NULL | STATS doc_count = COUNT(*), latency = AVG(\`transaction.duration.us\`), sessions = COUNT_DISTINCT(\`session.id\`) BY \`device.model.identifier\` | SORT doc_count DESC, \`device.model.identifier\` ASC | LIMIT 1000",
      }
    `);
    expect(requestOf(esql, 'get_mobile_crashes')).toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000040000,
                    "lte": 1700001240000,
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
              Object {
                "bool": Object {
                  "minimum_should_match": 1,
                  "should": Array [
                    Object {
                      "match_phrase": Object {
                        "service.version": "1",
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
            "service_name_value": "svc",
          },
          Object {
            "errorType": "crash",
          },
        ],
        "query": "SET unmapped_fields = \\"nullify\\"; FROM myIndex | WHERE \`service.name\` == ?service_name_value | WHERE \`device.model.identifier\` IS NOT NULL | STATS doc_count = COUNT(*), crashes = COUNT(*) WHERE \`error.type\` == ?errorType BY \`device.model.identifier\` | SORT doc_count DESC, \`device.model.identifier\` ASC | LIMIT 1000",
      }
    `);
  });

  it('gives each requested value its latency and throughput in every bucket', async () => {
    const { esql, apmEventClient } = createClient({
      get_mobile_detailed_statistics_by_field: [
        esqlResponse(
          ['doc_count', 'latency', field, 'bucket'],
          [
            [2, 100, 'pixel', bucketKeys[0]],
            [6, 300, 'pixel', bucketKeys[1]],
            [1, 50, 'iphone', bucketKeys[0]],
          ]
        ),
      ],
    });

    const result = await getMobileDetailedStatisticsByFieldPeriods({
      ...common,
      field,
      fieldValues: ['pixel', 'iphone'],
      apmEventClient,
    });

    expect(Object.keys(result.currentPeriod)).toEqual(['pixel', 'iphone']);
    expect(result.currentPeriod.pixel.throughput.slice(0, 3)).toEqual([
      { x: bucketKeys[0], y: 2 },
      { x: bucketKeys[1], y: 6 },
      { x: bucketKeys[2], y: 0 },
    ]);
    expect(result.currentPeriod.pixel.latency[2]).toEqual({ x: bucketKeys[2], y: null });
    expect(requestOf(esql, 'get_mobile_detailed_statistics_by_field')).toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000040000,
                    "lte": 1700001240000,
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
              Object {
                "bool": Object {
                  "minimum_should_match": 1,
                  "should": Array [
                    Object {
                      "match_phrase": Object {
                        "service.version": "1",
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
            "service_name_value": "svc",
          },
          Object {
            "fieldValues": Array [
              "pixel",
              "iphone",
            ],
          },
          Object {
            "intervalMs": 60000,
          },
        ],
        "query": "SET unmapped_fields = \\"nullify\\"; FROM myIndex | WHERE \`service.name\` == ?service_name_value | WHERE \`device.model.identifier\` IN (?fieldValues) | EVAL bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ?intervalMs | STATS doc_count = COUNT(*), latency = AVG(\`transaction.duration.us\`) BY \`device.model.identifier\`, bucket | LIMIT 42",
      }
    `);
  });

  it('does not query when no field value is requested', async () => {
    const { esql, apmEventClient } = createClient();

    const result = await getMobileDetailedStatisticsByFieldPeriods({
      ...common,
      field,
      fieldValues: [],
      apmEventClient,
    });

    expect(result.currentPeriod).toEqual({});
    expect(esql).not.toHaveBeenCalled();
  });
});

describe('mobile error group sparklines', () => {
  const groupParams = { ...common, numBuckets: 20, groupIds: ['g1', 'g2'] };
  const groupsResponse = esqlResponse(
    ['doc_count', 'error.grouping_key', 'bucket'],
    [
      [3, 'g1', bucketKeys[0]],
      [1, 'g2', bucketKeys[1]],
    ]
  );

  it('counts the crashes of each group per bucket', async () => {
    const { esql, apmEventClient } = createClient({
      get_service_error_group_detailed_statistics: [groupsResponse],
    });

    const result = await getMobileCrashesGroupPeriods({ ...groupParams, apmEventClient });

    expect(Object.keys(result.currentPeriod)).toEqual(['g1', 'g2']);
    expect(result.currentPeriod.g1.timeseries[0]).toEqual({ x: bucketKeys[0], y: 3 });
    expect(requestOf(esql, 'get_service_error_group_detailed_statistics')).toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000040000,
                    "lte": 1700001240000,
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
              Object {
                "bool": Object {
                  "minimum_should_match": 1,
                  "should": Array [
                    Object {
                      "match_phrase": Object {
                        "service.version": "1",
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
            "error_type_value": "crash",
          },
          Object {
            "service_name_value": "svc",
          },
          Object {
            "error_grouping_key_values": Array [
              "g1",
              "g2",
            ],
          },
          Object {
            "intervalMs": 60000,
          },
        ],
        "query": "FROM myIndex | WHERE \`error.type\` == ?error_type_value | WHERE \`service.name\` == ?service_name_value | WHERE \`error.grouping_key\` IN (?error_grouping_key_values) | EVAL bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ?intervalMs | STATS doc_count = COUNT(*) BY \`error.grouping_key\`, bucket | LIMIT 42",
      }
    `);
  });

  it('counts the errors of each group per bucket, leaving the crashes out', async () => {
    const { esql, apmEventClient } = createClient({
      get_service_error_group_detailed_statistics: [groupsResponse],
    });

    const result = await getMobileErrorGroupPeriods({ ...groupParams, apmEventClient });

    expect(result.currentPeriod.g2.timeseries.find(({ y }) => (y ?? 0) > 0)).toEqual({
      x: bucketKeys[1],
      y: 1,
    });
    expect(
      JSON.stringify(requestOf(esql, 'get_service_error_group_detailed_statistics').filter)
    ).toContain('"must_not"');
  });
});
