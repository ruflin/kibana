/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import { getIndexStatus } from './get_index_status';
import { getUptimeESMockClient } from './test_helpers';

const columns = [
  { name: '@timestamp', type: 'date' },
  { name: 'monitor.id', type: 'keyword' },
];

const unknownIndexError = () =>
  new errors.ResponseError({
    statusCode: 400,
    body: { error: { type: 'verification_exception', reason: 'Unknown index [heartbeat-*]' } },
    headers: {},
    warnings: [],
    meta: {} as any,
  });

describe('getIndexStatus', () => {
  it('reports that the index exists when a document is found, bounded by the range', async () => {
    const { esClient, uptimeEsClient } = getUptimeESMockClient();
    esClient.esql.query.mockResolvedValue({ columns, values: [['2021-01-01', 'a']] } as any);

    const status = await getIndexStatus({
      uptimeEsClient,
      range: { from: 'now-15m', to: 'now' },
    });

    expect(status).toEqual({ indices: 'heartbeat-*', indexExists: true });
    expect(esClient.esql.query.mock.calls[0][0]).toEqual({
      query: 'FROM heartbeat-* | LIMIT 1',
      params: [],
      filter: { range: { '@timestamp': { gte: 'now-15m', lte: 'now' } } },
    });
  });

  it('reports that the index does not exist when there is no document', async () => {
    const { esClient, uptimeEsClient } = getUptimeESMockClient();
    esClient.esql.query.mockResolvedValue({ columns, values: [] } as any);

    expect(await getIndexStatus({ uptimeEsClient })).toEqual({
      indices: 'heartbeat-*',
      indexExists: false,
    });
    expect(esClient.esql.query.mock.calls[0][0]).toEqual({
      query: 'FROM heartbeat-* | LIMIT 1',
      params: [],
    });
  });

  it('does not throw when no index matches', async () => {
    const { esClient, uptimeEsClient } = getUptimeESMockClient();
    esClient.esql.query.mockRejectedValue(unknownIndexError());

    expect(await getIndexStatus({ uptimeEsClient })).toEqual({ indices: '', indexExists: false });
  });
});
