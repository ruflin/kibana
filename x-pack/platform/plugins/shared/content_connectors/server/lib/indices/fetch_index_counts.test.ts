/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IScopedClusterClient } from '@kbn/core/server';

import { fetchIndexCounts } from './fetch_index_counts';

describe('fetchIndexCounts lib function', () => {
  const mockClient = {
    asCurrentUser: {
      esql: {
        query: jest
          .fn()
          .mockReturnValue({ columns: [{ name: 'total', type: 'long' }], values: [[100]] }),
      },
    },
  };

  it('returns count api response for each index name provided', async () => {
    const indexNames = ['index1', 'index2', 'index3'];

    await expect(
      fetchIndexCounts(mockClient as unknown as IScopedClusterClient, indexNames)
    ).resolves.toEqual({
      index1: 100,
      index2: 100,
      index3: 100,
    });
  });

  it('counts each index with its own query', async () => {
    await fetchIndexCounts(mockClient as unknown as IScopedClusterClient, ['index2']);

    expect(mockClient.asCurrentUser.esql.query).toHaveBeenCalledWith({
      query: 'FROM index2 | STATS total = COUNT(*)',
    });
  });

  it('returns a zero count for an index that breaks without failing the others', async () => {
    mockClient.asCurrentUser.esql.query.mockRejectedValueOnce(new Error('index closed'));

    await expect(
      fetchIndexCounts(mockClient as unknown as IScopedClusterClient, ['broken', 'index2'])
    ).resolves.toEqual({ broken: 0, index2: 100 });
  });
});
