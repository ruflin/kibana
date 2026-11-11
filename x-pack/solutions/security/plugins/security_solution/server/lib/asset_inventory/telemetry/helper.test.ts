/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import { getEntityStats } from './collectors/entities_stats_collector';
import { ENTITY_INDEX, getFieldTermsStats } from './helper';

describe('asset inventory telemetry ES|QL reads', () => {
  const esClient = elasticsearchServiceMock.createElasticsearchClient();

  beforeEach(() => jest.clearAllMocks());

  it('getFieldTermsStats groups by the field, newest write first, and parses the buckets', async () => {
    esClient.esql.query.mockResolvedValueOnce({
      columns: [
        { name: 'doc_count', type: 'long' },
        { name: 'last_doc_timestamp', type: 'date' },
        { name: 'field_value', type: 'keyword' },
      ],
      values: [
        [7, '2025-03-01T10:00:00.000Z', 'host'],
        [2, '2025-02-01T10:00:00.000Z', 'user'],
      ],
    });

    const buckets = await getFieldTermsStats(esClient, 'entity.EngineMetadata.Type', 5);

    expect(buckets).toEqual([
      {
        key: 'host',
        doc_count: 7,
        last_doc_timestamp: {
          value: Date.parse('2025-03-01T10:00:00.000Z'),
          value_as_string: '2025-03-01T10:00:00.000Z',
        },
      },
      {
        key: 'user',
        doc_count: 2,
        last_doc_timestamp: {
          value: Date.parse('2025-02-01T10:00:00.000Z'),
          value_as_string: '2025-02-01T10:00:00.000Z',
        },
      },
    ]);
    expect(esClient.esql.query.mock.calls[0][0]).toMatchObject({
      query: `FROM ${ENTITY_INDEX} | STATS doc_count = COUNT(*), last_doc_timestamp = MAX(@timestamp) BY field_value = entity.EngineMetadata.Type | WHERE field_value IS NOT NULL | SORT last_doc_timestamp DESC NULLS LAST | LIMIT 5`,
    });
  });

  it('getEntityStats reads the latest timestamp with MAX(@timestamp)', async () => {
    esClient.indices.exists.mockResolvedValueOnce(true);
    esClient.indices.stats.mockResolvedValueOnce({
      _all: { primaries: { docs: { count: 12 } } },
    } as never);
    esClient.esql.query.mockResolvedValueOnce({
      columns: [{ name: 'latest', type: 'date' }],
      values: [['2025-03-01T10:00:00.000Z']],
    });

    const stats = await getEntityStats(esClient, ENTITY_INDEX, loggingSystemMock.createLogger());

    expect(stats).toEqual({ doc_count: 12, last_doc_timestamp: '2025-03-01T10:00:00.000Z' });
    expect(esClient.esql.query.mock.calls[0][0]).toMatchObject({
      query: `FROM ${ENTITY_INDEX} | STATS latest = MAX(@timestamp)`,
    });
  });
});
