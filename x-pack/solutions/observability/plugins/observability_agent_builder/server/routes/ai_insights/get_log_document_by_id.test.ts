/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { getLogDocumentById } from './get_log_document_by_id';

describe('getLogDocumentById', () => {
  const esClient = elasticsearchServiceMock.createElasticsearchClient();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('looks the document up by _id and returns only the requested fields that have a value', async () => {
    esClient.esql.query.mockResolvedValue({
      columns: [
        { name: '_id', type: 'keyword' },
        { name: '@timestamp', type: 'date' },
        { name: 'message', type: 'keyword' },
        { name: 'log.level', type: 'keyword' },
        { name: 'host.name', type: 'keyword' },
      ],
      values: [['doc-1', '2026-01-01T00:00:00.000Z', 'boom', null, 'host-1']],
    } as never);

    const doc = await getLogDocumentById({ esClient, index: 'logs-*', id: 'doc-1' });

    expect(esClient.esql.query).toHaveBeenCalledWith({
      query: 'FROM logs-* METADATA _id | WHERE _id == ?id | LIMIT 1',
      params: [{ id: 'doc-1' }],
    });
    expect(doc).toEqual({ '@timestamp': '2026-01-01T00:00:00.000Z', message: 'boom' });
  });

  it('returns undefined when there is no document', async () => {
    esClient.esql.query.mockResolvedValue({ columns: [], values: [] } as never);

    expect(await getLogDocumentById({ esClient, index: 'logs-*', id: 'nope' })).toBeUndefined();
  });
});
