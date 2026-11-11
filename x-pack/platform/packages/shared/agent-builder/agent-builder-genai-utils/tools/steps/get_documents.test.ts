/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { getDocumentById } from './get_documents';

describe('getDocumentById', () => {
  describe('CCS targets', () => {
    it('uses _search with term query for a CCS index', async () => {
      const esClient = {
        esql: {
          query: jest.fn().mockResolvedValue({
            columns: [
              { name: '_id', type: 'keyword' },
              { name: '_index', type: 'keyword' },
              { name: '_source', type: '_source' },
            ],
            values: [['doc-123', 'remote_cluster:logs-test', { message: 'hello', level: 'info' }]],
          }),
        },
        get: jest.fn(),
      } as unknown as ElasticsearchClient;

      const result = await getDocumentById({
        id: 'doc-123',
        index: 'remote_cluster:logs-test',
        esClient,
      });

      // Should use _search, not _get
      expect(esClient.esql.query).toHaveBeenCalledWith({
        query:
          'FROM remote_cluster:logs-test METADATA _id, _index, _source | WHERE _id == ?id | KEEP _id, _index, _source | LIMIT 1',
        params: [{ id: 'doc-123' }],
        filter: { bool: { must_not: [{ term: { _tier: 'data_frozen' } }] } },
      });
      expect(esClient.get).not.toHaveBeenCalled();

      expect(result).toEqual({
        id: 'doc-123',
        index: 'remote_cluster:logs-test',
        found: true,
        _source: { message: 'hello', level: 'info' },
      });
    });

    it('returns not found when _search returns no hits for a CCS index', async () => {
      const esClient = {
        esql: { query: jest.fn().mockResolvedValue({ columns: [], values: [] }) },
        get: jest.fn(),
      } as unknown as ElasticsearchClient;

      const result = await getDocumentById({
        id: 'nonexistent',
        index: 'remote_cluster:logs-test',
        esClient,
      });

      expect(result).toEqual({
        id: 'nonexistent',
        index: 'remote_cluster:logs-test',
        found: false,
      });
    });

    it('omits the frozen tier exclusion when frozen tier indices are included', async () => {
      const esClient = {
        esql: { query: jest.fn().mockResolvedValue({ columns: [], values: [] }) },
        get: jest.fn(),
      } as unknown as ElasticsearchClient;

      await getDocumentById({
        id: 'doc-123',
        index: 'remote_cluster:logs-test',
        includeFrozen: true,
        esClient,
      });

      const searchCall = (esClient.esql.query as jest.Mock).mock.calls[0][0];
      expect(searchCall).not.toHaveProperty('filter');
    });
  });

  it('rejects a CCS index name that is not a plain index pattern', async () => {
    const esClient = { esql: { query: jest.fn() } } as unknown as ElasticsearchClient;

    await expect(
      getDocumentById({ id: 'doc-1', index: 'remote:logs | DROP message', esClient })
    ).rejects.toThrow('Invalid index name or pattern');
    expect(esClient.esql.query).not.toHaveBeenCalled();
  });

  describe('local targets', () => {
    it('uses _get API for a local index', async () => {
      const esClient = {
        search: jest.fn(),
        get: jest.fn().mockResolvedValue({
          body: {
            _id: 'doc-456',
            _index: 'my-local-index',
            _source: { title: 'test' },
          },
          statusCode: 200,
        }),
      } as unknown as ElasticsearchClient;

      const result = await getDocumentById({
        id: 'doc-456',
        index: 'my-local-index',
        esClient,
      });

      // Should use _get, not _search
      expect(esClient.get).toHaveBeenCalledWith(
        { id: 'doc-456', index: 'my-local-index' },
        { ignore: [404], meta: true }
      );
      expect(esClient.search).not.toHaveBeenCalled();

      expect(result).toEqual({
        id: 'doc-456',
        index: 'my-local-index',
        found: true,
        _source: { title: 'test' },
      });
    });

    it('returns not found when _get returns 404 for a local index', async () => {
      const esClient = {
        search: jest.fn(),
        get: jest.fn().mockResolvedValue({
          body: {},
          statusCode: 404,
        }),
      } as unknown as ElasticsearchClient;

      const result = await getDocumentById({
        id: 'missing',
        index: 'my-local-index',
        esClient,
      });

      expect(result).toEqual({
        id: 'missing',
        index: 'my-local-index',
        found: false,
      });
    });
  });
});
