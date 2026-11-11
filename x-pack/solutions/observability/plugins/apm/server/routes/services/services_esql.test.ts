/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ESQLSearchResponse } from '@kbn/es-types';
import type { APMEventClient } from '@kbn/apm-data-access-plugin/server';
import { ApmDocumentType } from '../../../common/document_type';
import { RollupInterval } from '../../../common/rollup';
import type { APMEventEsqlRequest } from '../../utils/esql_test_helpers';
import { esqlResponse, toEsqlRequest } from '../../utils/esql_test_helpers';
import { getDerivedServiceAnnotations } from './annotations/get_derived_service_annotations';
import { getServiceHasSystemMetrics } from './get_service_has_system_metrics';
import { getServiceInstanceMetadataDetails } from './get_service_instance_metadata_details';
import { getServiceNodeMetadata } from './get_service_node_metadata';
import { getServiceTransactionTypes } from './get_service_transaction_types';

const start = 1_700_000_000_000;
const end = 1_700_000_900_000;

/** A client whose `esql` answers by operation name, in order. */
function createClient(responses: Record<string, ESQLSearchResponse[]>) {
  const esql = jest.fn(async (operationName: string, _params?: APMEventEsqlRequest) => {
    return responses[operationName]?.shift() ?? esqlResponse([], []);
  });
  return { esql, apmEventClient: { esql } as unknown as APMEventClient };
}

const requestOf = (esql: jest.Mock, callIndex = 0) => {
  const { query, params, filter } = toEsqlRequest(esql.mock.calls[callIndex][1]);
  return { query, params, filter };
};

describe('getServiceTransactionTypes', () => {
  it('counts the transaction types of the service and leaves out page-exit', async () => {
    const { esql, apmEventClient } = createClient({
      get_service_transaction_types: [
        esqlResponse(
          ['doc_count', 'transaction.type'],
          [
            [10, 'request'],
            [5, 'page-exit'],
            [2, 'page-load'],
          ]
        ),
      ],
    });

    const result = await getServiceTransactionTypes({
      apmEventClient,
      serviceName: 'svc',
      start,
      end,
      documentType: ApmDocumentType.ServiceTransactionMetric,
      rollupInterval: RollupInterval.OneMinute,
    });

    expect(result).toEqual({ transactionTypes: ['request', 'page-load'] });
    expect(esql.mock.calls[0]?.[1]?.apm).toEqual({
      sources: [
        {
          documentType: ApmDocumentType.ServiceTransactionMetric,
          rollupInterval: RollupInterval.OneMinute,
        },
      ],
    });
    expect(requestOf(esql)).toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000000000,
                    "lte": 1700000900000,
                  },
                },
              },
            ],
          },
        },
        "params": Array [
          Object {
            "serviceName": "svc",
          },
        ],
        "query": "FROM myIndex | WHERE \`service.name\` == ?serviceName | STATS doc_count = COUNT(*) BY \`transaction.type\` | SORT doc_count DESC, \`transaction.type\` ASC | LIMIT 100",
      }
    `);
  });
});

describe('getServiceNodeMetadata', () => {
  it('reads the most frequent host and container id of the node', async () => {
    const { esql, apmEventClient } = createClient({
      get_service_node_metadata_host: [esqlResponse(['doc_count', 'host.name'], [[4, 'host-1']])],
    });

    const result = await getServiceNodeMetadata({
      apmEventClient,
      kuery: '',
      serviceName: 'svc',
      serviceNodeName: 'node-1',
      environment: 'production',
      start,
      end,
      documentType: ApmDocumentType.TransactionMetric,
      rollupInterval: RollupInterval.OneMinute,
    });

    expect(result).toEqual({ host: 'host-1', containerId: 'N/A' });
    expect(requestOf(esql)).toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000000000,
                    "lte": 1700000900000,
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
                "term": Object {
                  "service.node.name": "node-1",
                },
              },
            ],
          },
        },
        "params": Array [
          Object {
            "serviceName": "svc",
          },
        ],
        "query": "SET unmapped_fields = \\"nullify\\"; FROM myIndex | WHERE \`service.name\` == ?serviceName AND \`host.name\` IS NOT NULL | STATS doc_count = COUNT(*) BY \`host.name\` | SORT doc_count DESC, \`host.name\` ASC | LIMIT 1",
      }
    `);
  });
});

describe('getServiceHasSystemMetrics', () => {
  it.each([
    ['true when a metric document has system metrics', [['svc']], true],
    ['false when no metric document has system metrics', [], false],
  ])('returns %s', async (_name, values, expected) => {
    const { esql, apmEventClient } = createClient({
      get_service_has_system_metrics: [esqlResponse(['service.name'], values)],
    });

    const result = await getServiceHasSystemMetrics({
      apmEventClient,
      serviceName: 'svc',
      environment: 'production',
      start,
      end,
    });

    expect(result).toEqual({ hasSystemMetrics: expected });
    expect(esql.mock.calls[0]?.[1]?.apm).toEqual({ events: ['metric'] });
  });

  it('looks for a document with the CPU, cgroup memory or free and total memory metrics', async () => {
    const { esql, apmEventClient } = createClient({});

    await getServiceHasSystemMetrics({
      apmEventClient,
      serviceName: 'svc',
      environment: 'production',
      start,
      end,
    });

    expect(requestOf(esql)).toMatchInlineSnapshot(`
      Object {
        "filter": Object {
          "bool": Object {
            "filter": Array [
              Object {
                "range": Object {
                  "@timestamp": Object {
                    "format": "epoch_millis",
                    "gte": 1700000000000,
                    "lte": 1700000900000,
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
            "serviceName": "svc",
          },
        ],
        "query": "SET unmapped_fields = \\"nullify\\"; FROM myIndex | WHERE \`service.name\` == ?serviceName | WHERE \`system.cpu.total.norm.pct\` IS NOT NULL OR \`system.process.cgroup.memory.mem.usage.bytes\` IS NOT NULL OR \`system.memory.actual.free\` IS NOT NULL AND \`system.memory.total\` IS NOT NULL | KEEP \`service.name\` | LIMIT 1",
      }
    `);
  });
});

describe('getServiceInstanceMetadataDetails', () => {
  it('merges the application metric, transaction event and transaction metric samples', async () => {
    const { esql, apmEventClient } = createClient({
      get_service_instance_metadata_details_application_metric: [
        esqlResponse(
          ['@timestamp', 'service.name', 'agent.name', 'host.name'],
          [['2023-11-14T22:13:20.000Z', 'svc', 'java', 'host-1']]
        ),
      ],
      get_service_instance_metadata_details_application_transaction_event: [
        esqlResponse(
          ['@timestamp', 'service.name', 'cloud.region'],
          [['2023-11-14T22:13:20.000Z', 'svc', 'eu']]
        ),
      ],
    });

    const result = await getServiceInstanceMetadataDetails({
      apmEventClient,
      serviceName: 'svc',
      serviceNodeName: 'node-1',
      start,
      end,
    });

    expect(result).toMatchObject({
      agent: { name: 'java' },
      host: { name: 'host-1' },
      cloud: { region: 'eu' },
    });
    expect(esql).toHaveBeenCalledTimes(3);
    const { query, params } = requestOf(esql);
    expect(query).toContain('SET unmapped_fields = "nullify"');
    expect(query).toContain('WHERE `metricset.name` == ?metricsetName');
    expect(query).toContain('LIMIT 1');
    expect(params).toEqual(
      expect.arrayContaining([
        { serviceName: 'svc' },
        { serviceNodeName: 'node-1' },
        { metricsetName: 'app' },
      ])
    );
  });
});

describe('getDerivedServiceAnnotations', () => {
  const baseParams = {
    serviceName: 'svc',
    environment: 'production',
    searchAggregatedTransactions: false,
    start,
    end,
  };

  it('annotates the first time each version was seen, when it is inside the range', async () => {
    const { esql, apmEventClient } = createClient({
      get_derived_service_annotations: [
        esqlResponse(
          ['doc_count', 'service.version'],
          [
            [9, '2.0'],
            [4, '1.0'],
          ]
        ),
      ],
      get_first_seen_of_version: [
        esqlResponse(
          ['first_seen', 'service.version'],
          [
            [new Date(start + 1000).toISOString(), '2.0'],
            [new Date(start - 1000).toISOString(), '1.0'],
          ]
        ),
      ],
    });

    const result = await getDerivedServiceAnnotations({ ...baseParams, apmEventClient });

    expect(result).toEqual([
      { type: 'version', id: '2.0', '@timestamp': start + 1000, text: '2.0' },
    ]);
    expect(requestOf(esql, 0)).toMatchInlineSnapshot(`
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
                    "gte": 1700000000000,
                    "lte": 1700000900000,
                  },
                },
              },
            ],
          },
        },
        "params": Array [
          Object {
            "serviceName": "svc",
          },
        ],
        "query": "FROM myIndex | WHERE \`service.name\` == ?serviceName | STATS doc_count = COUNT(*) BY \`service.version\` | SORT doc_count DESC, \`service.version\` ASC | LIMIT 10",
      }
    `);
    expect(requestOf(esql, 1)).toMatchInlineSnapshot(`
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
            ],
          },
        },
        "params": Array [
          Object {
            "serviceName": "svc",
          },
          Object {
            "versions": Array [
              "2.0",
              "1.0",
            ],
          },
        ],
        "query": "FROM myIndex | WHERE \`service.name\` == ?serviceName | WHERE \`service.version\` IN (?versions) | STATS first_seen = MIN(@timestamp) BY \`service.version\` | LIMIT 2",
      }
    `);
  });

  it('does not look for the first seen time when there is at most one version', async () => {
    const { esql, apmEventClient } = createClient({
      get_derived_service_annotations: [
        esqlResponse(['doc_count', 'service.version'], [[9, '2.0']]),
      ],
    });

    const result = await getDerivedServiceAnnotations({ ...baseParams, apmEventClient });

    expect(result).toEqual([]);
    expect(esql).toHaveBeenCalledTimes(1);
  });
});
