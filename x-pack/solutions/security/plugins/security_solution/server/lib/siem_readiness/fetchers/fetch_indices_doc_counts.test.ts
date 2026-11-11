/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { ElasticsearchClient } from '@kbn/core/server';
import { fetchIndicesDocCounts } from './fetch_indices_doc_counts';

const esClient = { esql: { query: jest.fn() } } as unknown as ElasticsearchClient;
const query = esClient.esql.query as jest.Mock;

const responseError = (statusCode: number, body: unknown) =>
  new errors.ResponseError({
    statusCode,
    body,
    headers: {},
    warnings: [],
    meta: {} as never,
  });

describe('fetchIndicesDocCounts', () => {
  beforeEach(() => jest.clearAllMocks());

  it('counts the documents of each index with ES|QL', async () => {
    query.mockResolvedValueOnce({ columns: [{ name: 'total', type: 'long' }], values: [[42]] });

    const result = await fetchIndicesDocCounts({ esClient, indices: ['logs-a'] });

    expect(result).toEqual([{ index: 'logs-a', docCount: 42, exists: true }]);
    expect(query).toHaveBeenCalledWith(
      { query: 'FROM logs-a | STATS total = COUNT(*)', params: [] },
      { signal: undefined }
    );
  });

  it('counts an index that is not there as empty, like ignore_unavailable did', async () => {
    query.mockRejectedValueOnce(
      responseError(400, {
        error: {
          type: 'verification_exception',
          reason: 'Found 1 problem\nline 1:1: Unknown index [logs-missing]',
        },
      })
    );

    const result = await fetchIndicesDocCounts({ esClient, indices: ['logs-missing'] });

    expect(result).toEqual([{ index: 'logs-missing', docCount: 0, exists: true }]);
  });

  it.each(['logs-a | DROP message', 'logs-a\nFROM other', 'logs-a,logs-b', '"logs-a"', '_hidden'])(
    'does not query the invalid index %j',
    async (index) => {
      const result = await fetchIndicesDocCounts({ esClient, indices: [index] });

      expect(result).toEqual([
        { index, docCount: 0, exists: false, error: 'Invalid index name or pattern' },
      ]);
      expect(query).not.toHaveBeenCalled();
    }
  );

  it('reports other failures on the index', async () => {
    query.mockRejectedValueOnce(new Error('boom'));

    const result = await fetchIndicesDocCounts({ esClient, indices: ['logs-a'] });

    expect(result).toEqual([{ index: 'logs-a', docCount: 0, exists: false, error: 'boom' }]);
  });
});
