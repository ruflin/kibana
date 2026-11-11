/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { countDocuments, isEsqlUnknownIndexError } from './esql_count';

describe('countDocuments', () => {
  const client = elasticsearchServiceMock.createElasticsearchClient();

  beforeEach(() => {
    jest.resetAllMocks();
    client.esql.query.mockResolvedValue({
      columns: [{ name: 'total', type: 'long' }],
      values: [[42]],
    } as never);
  });

  it('counts the documents of the index', async () => {
    await expect(countDocuments(client, 'my-index')).resolves.toBe(42);
    expect(client.esql.query).toHaveBeenCalledWith({
      query: 'FROM my-index | STATS total = COUNT(*)',
    });
  });

  it('quotes an index name that is not a plain index pattern', async () => {
    await countDocuments(client, 'a, b" | DROP x');

    expect(client.esql.query).toHaveBeenCalledWith({
      query: 'FROM a, "b\\" | DROP x" | STATS total = COUNT(*)',
    });
  });
});

describe('isEsqlUnknownIndexError', () => {
  it('matches the verification exception for a missing index only', () => {
    const error = (statusCode: number, type: string, reason: string) => ({
      statusCode,
      body: { error: { type, reason } },
    });

    expect(isEsqlUnknownIndexError(error(400, 'verification_exception', 'Unknown index [x]'))).toBe(
      true
    );
    expect(
      isEsqlUnknownIndexError(error(400, 'verification_exception', 'Unknown column [x]'))
    ).toBe(false);
    expect(isEsqlUnknownIndexError(error(404, 'index_not_found_exception', 'no such index'))).toBe(
      false
    );
    expect(isEsqlUnknownIndexError(new Error('boom'))).toBe(false);
  });
});
