/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import type { PrivilegeMonitoringDataClient } from '../../../engine/data_client';
import { findStaleUsersFactory } from './stale_users';

describe('findStaleUsersFactory', () => {
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  const dataClient = {
    index: 'users-index',
    deps: { clusterClient: { asCurrentUser: esClient } },
  } as unknown as PrivilegeMonitoringDataClient;
  const findStaleUsers = findStaleUsersFactory(dataClient);

  beforeEach(() => {
    jest.clearAllMocks();
    esClient.esql.query.mockResolvedValue({
      columns: [
        { name: 'user.name', type: 'keyword' },
        { name: '_id', type: 'keyword' },
      ],
      values: [['carol', 'id-3']],
    } as never);
  });

  it('finds the privileged users of the source that are not listed any more', async () => {
    const result = await findStaleUsers('source-1', ['alice', 'bob'], 'index');

    expect(result).toEqual([
      { username: 'carol', existingUserId: 'id-3', sourceId: 'source-1', isPrivileged: false },
    ]);
    expect(esClient.esql.query).toHaveBeenCalledWith(
      {
        query:
          'FROM users-index METADATA _id | WHERE user.is_privileged == TRUE | WHERE NOT (user.name IN (?userNames)) | KEEP user.name, _id | LIMIT 10',
        params: [{ userNames: ['alice', 'bob'] }],
        filter: {
          bool: {
            filter: [
              { term: { 'labels.sources': 'index' } },
              { term: { 'labels.source_ids.keyword': 'source-1' } },
            ],
          },
        },
      },
      { signal: undefined }
    );
  });

  it('leaves the user name exclusion out when no user is listed', async () => {
    await findStaleUsers('source-1', [], 'entity_analytics_integration');

    const [request] = esClient.esql.query.mock.calls[0];
    expect(request.query).toBe(
      'FROM users-index METADATA _id | WHERE user.is_privileged == TRUE | KEEP user.name, _id | LIMIT 10'
    );
  });
});
