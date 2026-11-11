/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import type { PrivilegeMonitoringDataClient } from '../engine/data_client';
import { createSearchService } from './search';

describe('privileged users search service', () => {
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  const dataClient = {
    index: '.entity_analytics.monitoring.users-default',
    log: jest.fn(),
    deps: { clusterClient: { asCurrentUser: esClient } },
  } as unknown as PrivilegeMonitoringDataClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('looks the usernames up with ES|QL and maps each name to its document id', async () => {
    esClient.esql.query.mockResolvedValue({
      columns: [
        { name: 'user.name', type: 'keyword' },
        { name: '_id', type: 'keyword' },
      ],
      values: [
        ['alice', 'id-1'],
        ['bob', 'id-2'],
      ],
    } as never);

    const result = await createSearchService(dataClient).getExistingUsersMap(['alice', 'bob']);

    expect(result).toEqual(
      new Map([
        ['alice', 'id-1'],
        ['bob', 'id-2'],
      ])
    );
    expect(esClient.esql.query).toHaveBeenCalledWith(
      {
        query: `FROM ${dataClient.index} METADATA _id | WHERE user.name IN (?usernames) | KEEP user.name, _id | LIMIT 2`,
        params: [{ usernames: ['alice', 'bob'] }],
      },
      { signal: undefined }
    );
  });

  it('does not query without usernames', async () => {
    expect(await createSearchService(dataClient).getExistingUsersMap([])).toEqual(new Map());
    expect(esClient.esql.query).not.toHaveBeenCalled();
  });
});
