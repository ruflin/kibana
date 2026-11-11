/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { IScopedClusterClient } from '@kbn/core/server';

import { CONNECTORS_INDEX, CONNECTORS_JOBS_INDEX } from '@kbn/search-connectors';

import type { SyncJobsStats } from '../../../common/stats';

import {
  getConnectedCountQuery,
  getErrorCountQuery,
  getIdleJobsCountQuery,
  getIncompleteCountQuery,
  getInProgressJobsCountQuery,
  getOrphanedJobsCountQuery,
} from '../../utils/get_sync_jobs_queries';
import {
  esqlCount,
  isEsqlUnknownIndexException,
  runEsql,
  toEsqlSource,
} from '../../utils/esql_helpers';
import { isIndexNotFoundException } from '../../utils/identify_exceptions';

export const fetchSyncJobsStats = async (
  client: IScopedClusterClient,
  isCrawler?: boolean
): Promise<SyncJobsStats> => {
  try {
    // The search returned the default 10 hits, and so does this.
    const connectorIdsResult = await runEsql(
      client.asCurrentUser,
      esql.from([toEsqlSource(CONNECTORS_INDEX)], ['_id']).pipe`KEEP _id`.limit(10)
    );
    const ids = connectorIdsResult.values.flatMap(([id]) => (typeof id === 'string' ? [id] : []));
    const orphanedJobsCount = await esqlCount(
      client.asCurrentUser,
      CONNECTORS_JOBS_INDEX,
      getOrphanedJobsCountQuery(ids, isCrawler)
    );

    const inProgressJobsCount = await esqlCount(
      client.asCurrentUser,
      CONNECTORS_JOBS_INDEX,
      getInProgressJobsCountQuery(isCrawler)
    );

    // Idle syncs don't make sense for Crawler, because it does not have concept of "Idle" syncs at all.
    // We tried tracking idle syncs in a way similar to connectors, but it results in all crawler jobs
    // marked as idle.
    const idleJobsCount = isCrawler
      ? 0
      : await esqlCount(client.asCurrentUser, CONNECTORS_JOBS_INDEX, getIdleJobsCountQuery());

    const errorCount = await esqlCount(
      client.asCurrentUser,
      CONNECTORS_INDEX,
      getErrorCountQuery(isCrawler)
    );

    const connectedCount = await esqlCount(
      client.asCurrentUser,
      CONNECTORS_INDEX,
      getConnectedCountQuery(isCrawler)
    );

    const incompleteCount = await esqlCount(
      client.asCurrentUser,
      CONNECTORS_INDEX,
      getIncompleteCountQuery(isCrawler)
    );

    const response = {
      connected: connectedCount,
      errors: errorCount,
      idle: idleJobsCount,
      in_progress: inProgressJobsCount,
      incomplete: incompleteCount,
      orphaned_jobs: orphanedJobsCount,
    };

    return response;
  } catch (error) {
    if (isIndexNotFoundException(error) || isEsqlUnknownIndexException(error)) {
      return {
        connected: 0,
        errors: 0,
        idle: 0,
        in_progress: 0,
        incomplete: 0,
        orphaned_jobs: 0,
      };
    }
    throw error;
  }
};
