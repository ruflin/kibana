/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { getIndices } from './register_get_route';

describe('getIndices', () => {
  const scopedClient = elasticsearchServiceMock.createScopedClusterClient();
  const { indices, esql } = scopedClient.asCurrentUser;

  beforeEach(() => {
    jest.resetAllMocks();
    indices.getAlias.mockResolvedValue({ statusCode: 404, body: {} } as never);
  });

  it('lists the indices that match the pattern by document count when no alias matches', async () => {
    esql.query.mockResolvedValue({
      columns: [
        { name: 'doc_count', type: 'long' },
        { name: '_index', type: 'keyword' },
      ],
      values: [
        [20, 'logs-b'],
        [5, 'logs-a'],
      ],
    } as never);

    await expect(getIndices(scopedClient, 'logs-*,metrics-*', 7)).resolves.toEqual([
      'logs-b',
      'logs-a',
    ]);
    expect(esql.query).toHaveBeenCalledWith({
      query:
        'FROM logs-*, metrics-* METADATA _index | STATS doc_count = COUNT(*) BY _index | SORT doc_count DESC, _index ASC | LIMIT 7',
    });
  });

  it('quotes index names that the ES|QL parser could not read as a source', async () => {
    esql.query.mockResolvedValue({ columns: [], values: [] } as never);

    await getIndices(scopedClient, 'a" | DROP x');

    expect(esql.query.mock.calls[0][0]).toEqual(
      expect.objectContaining({ query: expect.stringContaining('FROM "a\\" | DROP x" METADATA') })
    );
  });

  it('returns no indices when the pattern matches none', async () => {
    esql.query.mockRejectedValue(
      new errors.ResponseError({
        statusCode: 400,
        body: {
          error: { type: 'verification_exception', reason: 'Found 1 problem\nUnknown index [x]' },
        },
        headers: {},
        warnings: [],
        meta: {} as never,
      })
    );

    await expect(getIndices(scopedClient, 'nothing-*')).resolves.toEqual([]);
  });

  it('keeps the alias lookup when it matches', async () => {
    indices.getAlias.mockResolvedValue({
      statusCode: 200,
      body: { 'logs-1': { aliases: { logs: {} } } },
    } as never);

    await expect(getIndices(scopedClient, 'logs*')).resolves.toEqual(['logs-1', 'logs']);
    expect(esql.query).not.toHaveBeenCalled();
  });
});
