/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { getLatestEntityMetadataDoc } from './entity_metadata';

const responseError = (statusCode: number, type: string, reason: string) =>
  new errors.ResponseError({
    statusCode,
    body: { error: { type, reason } },
    headers: {},
    warnings: [],
    meta: {} as never,
  });

describe('getLatestEntityMetadataDoc', () => {
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  const params = { index: 'metadata-ds', entityId: 'host:a', eventAction: 'summary' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads the newest document of the entity and action', async () => {
    esClient.esql.query.mockResolvedValue({
      columns: [{ name: '_source', type: '_source' }],
      values: [[{ summary: 'latest' }]],
    } as never);

    const filter = [{ term: { 'entity.type': 'host' } }];
    await expect(getLatestEntityMetadataDoc(esClient, { ...params, filter })).resolves.toEqual({
      summary: 'latest',
    });
    expect(esClient.esql.query).toHaveBeenCalledWith({
      query:
        'FROM metadata-ds METADATA _source | WHERE event.action == ?eventAction AND entity.id == ?entityId | SORT @timestamp DESC NULLS LAST | LIMIT 1',
      params: [{ eventAction: 'summary' }, { entityId: 'host:a' }],
      filter: { bool: { filter } },
    });
  });

  it('returns null without a document', async () => {
    esClient.esql.query.mockResolvedValue({
      columns: [{ name: '_source', type: '_source' }],
      values: [],
    } as never);

    await expect(getLatestEntityMetadataDoc(esClient, params)).resolves.toBeNull();
  });

  it('returns null when the datastream does not exist', async () => {
    esClient.esql.query.mockRejectedValue(
      responseError(400, 'verification_exception', 'Found 1 problem\nline 1:1: Unknown index [x]')
    );

    await expect(getLatestEntityMetadataDoc(esClient, params)).resolves.toBeNull();
  });

  it('propagates a missing privilege', async () => {
    const error = responseError(403, 'security_exception', 'forbidden');
    esClient.esql.query.mockRejectedValue(error);

    await expect(getLatestEntityMetadataDoc(esClient, params)).rejects.toBe(error);
  });
});
