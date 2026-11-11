/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { left, right } from 'fp-ts/Either';
import { queryExistingUsers } from './query_existing_users';
import type { BulkPrivMonUser, BulkProcessingError } from './types';

describe('queryExistingUsers', () => {
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  const user = (username: string) =>
    right<BulkProcessingError, BulkPrivMonUser>({ username } as BulkPrivMonUser);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps the usernames of a batch that exist to their document ids', async () => {
    esClient.esql.query.mockResolvedValue({
      columns: [
        { name: 'user.name', type: 'keyword' },
        { name: '_id', type: 'keyword' },
      ],
      values: [['alice', 'id-1']],
    } as never);
    const batch = [
      user('alice'),
      user('bob'),
      left<BulkProcessingError, BulkPrivMonUser>({ message: 'bad row', username: null, index: 2 }),
    ];

    const result = await queryExistingUsers(esClient, 'users-index')(batch);

    expect(result).toEqual({ existingUsers: { alice: 'id-1' }, uploaded: batch });
    expect(esClient.esql.query).toHaveBeenCalledWith(
      {
        query:
          'FROM users-index METADATA _id | WHERE user.name IN (?usernames) | KEEP user.name, _id | LIMIT 3',
        params: [{ usernames: ['alice', 'bob'] }],
      },
      { signal: undefined }
    );
  });

  it('does not query when the batch holds no valid user', async () => {
    const batch = [
      left<BulkProcessingError, BulkPrivMonUser>({ message: 'bad row', username: null, index: 1 }),
    ];

    expect(await queryExistingUsers(esClient, 'users-index')(batch)).toEqual({
      existingUsers: {},
      uploaded: batch,
    });
    expect(esClient.esql.query).not.toHaveBeenCalled();
  });
});
