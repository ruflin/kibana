/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { IScopedClusterClient } from '@kbn/core/server';

import { fetchSyncJobsStats } from './get_sync_jobs';

jest.mock('@kbn/search-connectors', () => ({
  CONNECTORS_INDEX: '.elastic-connectors',
  CONNECTORS_JOBS_INDEX: '.elastic-connectors-sync-jobs',
  CRAWLER_SERVICE_TYPE: 'elastic-crawler',
  ConnectorStatus: { CONNECTED: 'connected', ERROR: 'error' },
  SyncStatus: { IN_PROGRESS: 'in_progress' },
}));

const countResponse = (total: number) => ({
  columns: [{ name: 'total', type: 'long' }],
  values: [[total]],
});

describe('fetchSyncJobsStats', () => {
  const query = jest.fn();
  const client = { asCurrentUser: { esql: { query } } } as unknown as IScopedClusterClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('counts jobs and connectors with a STATS per count, keeping the DSL conditions as filters', async () => {
    query
      .mockResolvedValueOnce({ columns: [{ name: '_id', type: 'keyword' }], values: [['c1']] })
      .mockResolvedValueOnce(countResponse(1)) // orphaned
      .mockResolvedValueOnce(countResponse(2)) // in progress
      .mockResolvedValueOnce(countResponse(3)) // idle
      .mockResolvedValueOnce(countResponse(4)) // errors
      .mockResolvedValueOnce(countResponse(5)) // connected
      .mockResolvedValueOnce(countResponse(6)); // incomplete

    await expect(fetchSyncJobsStats(client)).resolves.toEqual({
      orphaned_jobs: 1,
      in_progress: 2,
      idle: 3,
      errors: 4,
      connected: 5,
      incomplete: 6,
    });

    expect(query.mock.calls.map(([request]) => request.query)).toEqual([
      'FROM .elastic-connectors METADATA _id | KEEP _id | LIMIT 10',
      'FROM .elastic-connectors-sync-jobs | STATS total = COUNT(*)',
      'FROM .elastic-connectors-sync-jobs | STATS total = COUNT(*)',
      'FROM .elastic-connectors-sync-jobs | STATS total = COUNT(*)',
      'FROM .elastic-connectors | STATS total = COUNT(*)',
      'FROM .elastic-connectors | STATS total = COUNT(*)',
      'FROM .elastic-connectors | STATS total = COUNT(*)',
    ]);
    expect(query.mock.calls[1][0].filter).toEqual({
      bool: { must_not: [{ terms: { 'connector.id': ['c1'] } }] },
    });
  });

  it('skips the idle count for the crawler', async () => {
    query.mockResolvedValueOnce({ columns: [], values: [] }).mockResolvedValue(countResponse(1));

    await expect(fetchSyncJobsStats(client, true)).resolves.toEqual(
      expect.objectContaining({ idle: 0, in_progress: 1 })
    );
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('returns zero counts when the connectors index does not exist', async () => {
    query.mockRejectedValue(
      new errors.ResponseError({
        statusCode: 400,
        body: {
          error: {
            type: 'verification_exception',
            reason: 'Found 1 problem\nline 1:6: Unknown index [.elastic-connectors]',
          },
        },
        headers: {},
        meta: {} as never,
        warnings: [],
      })
    );

    await expect(fetchSyncJobsStats(client)).resolves.toEqual({
      connected: 0,
      errors: 0,
      idle: 0,
      in_progress: 0,
      incomplete: 0,
      orphaned_jobs: 0,
    });
  });
});
