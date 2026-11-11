/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { PrivilegeMonitoringDataClient } from '../../../engine/data_client';
import type { PrivMonBulkUser } from '../../../types';
import { esqlRows, runEsqlRead } from '../../../../utils/esql_read';

export const findStaleUsersFactory =
  (dataClient: PrivilegeMonitoringDataClient) =>
  async (
    sourceId: string,
    userNames: string[],
    labelsSource: 'index' | 'entity_analytics_integration'
  ): Promise<PrivMonBulkUser[]> => {
    const esClient = dataClient.deps.clusterClient.asCurrentUser;

    const privileged = esql.from([dataClient.index], ['_id']).where`user.is_privileged == TRUE`;
    // `IN ()` is not valid ES|QL, and a `must_not` on no names excluded nothing.
    const notListed =
      userNames.length > 0 ? privileged.where`NOT user.name IN (${{ userNames }})` : privileged;

    const response = await runEsqlRead({
      esClient,
      query: notListed.pipe`KEEP user.name, _id`.limit(10), // check this
      // `labels.*` are multi-valued: they stay exact matches in the request filter.
      filter: {
        bool: {
          filter: [
            { term: { 'labels.sources': labelsSource } },
            { term: { 'labels.source_ids.keyword': sourceId } },
          ],
        },
      },
    });

    return esqlRows(response).map((row) => ({
      username: typeof row['user.name'] === 'string' ? row['user.name'] : 'unknown',
      existingUserId: row._id as string,
      sourceId,
      isPrivileged: false,
    }));
  };
