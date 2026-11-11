/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SortResults } from '@elastic/elasticsearch/lib/api/types';
import { esql } from '@elastic/esql';
import { esqlRows, runEsqlRead } from '../../utils/esql_read';
import type { PrivilegeMonitoringDataClient } from '../engine/data_client';

export type SearchService = ReturnType<typeof createSearchService>;

export const createSearchService = (dataClient: PrivilegeMonitoringDataClient) => {
  const esClient = dataClient.deps.clusterClient.asCurrentUser;

  /** The id and user name of the monitored users with one of the names. */
  const getMonitoredUsers = async (
    batchUsernames: string[]
  ): Promise<Array<{ _id: string; username?: string }>> => {
    // `IN ()` is not valid ES|QL, and a `terms` query on no values matched nothing.
    if (batchUsernames.length === 0) return [];
    const response = await runEsqlRead({
      esClient,
      query: esql.from([dataClient.index], ['_id']).where`user.name IN (${{
        usernames: batchUsernames,
      }})`.pipe`KEEP user.name, _id`.limit(batchUsernames.length),
    });
    return esqlRows(response).map((row) => ({
      _id: row._id as string,
      username: typeof row['user.name'] === 'string' ? row['user.name'] : undefined,
    }));
  };

  const searchUsernamesInIndex = async ({
    indexName,
    batchSize,
    searchAfter,
    query,
  }: {
    indexName: string;
    batchSize: number;
    searchAfter?: SortResults;
    query: object;
  }) => {
    return esClient.search<{ user?: { name?: string } }>({
      index: indexName,
      size: batchSize,
      _source: ['user.name'],
      sort: [{ 'user.name': 'asc' }],
      search_after: searchAfter,
      query,
    });
  };

  const getExistingUsersMap = async (
    usernames: string[]
  ): Promise<Map<string, string | undefined>> => {
    const existingUserRes = await getMonitoredUsers(usernames);
    const existingUserMap = new Map<string, string | undefined>();
    for (const hit of existingUserRes) {
      const username = hit.username;
      dataClient.log('debug', `Found existing user: ${username} with ID: ${hit._id}`);
      if (username) existingUserMap.set(username, hit._id);
    }
    return existingUserMap;
  };

  return { getMonitoredUsers, searchUsernamesInIndex, getExistingUsersMap };
};
