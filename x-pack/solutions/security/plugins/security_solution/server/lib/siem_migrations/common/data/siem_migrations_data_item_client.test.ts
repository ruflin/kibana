/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IScopedClusterClient } from '@kbn/core/server';
import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import type { AuthenticatedUser } from '@kbn/security-plugin-types-common';
import type SearchApi from '@elastic/elasticsearch/lib/api/api/search';
import type { SiemMigrationsClientDependencies, ItemDocument } from '../types';
import { SiemMigrationsDataItemClient } from './siem_migrations_data_item_client';
import { dsl } from './dsl_queries';
import type { SiemMigrationSort } from './types';

type SearchApiResponse = Awaited<ReturnType<typeof SearchApi>>;

class TestSiemMigrationsDataItemClient extends SiemMigrationsDataItemClient<ItemDocument> {
  protected type = 'rule' as const;
  public getVendor = jest.fn().mockResolvedValue('qradar');
  protected getSortOptions(_sort?: SiemMigrationSort) {
    return [];
  }
}

describe('SiemMigrationsDataItemClient', () => {
  let client: TestSiemMigrationsDataItemClient;
  const esClient =
    elasticsearchServiceMock.createCustomClusterClient() as unknown as IScopedClusterClient;

  const logger = loggingSystemMock.createLogger();
  const indexNameProvider = jest
    .fn()
    .mockResolvedValue('.kibana-siem-rule-migrations-rules-default');
  const currentUser = {
    userName: 'testUser',
    profile_uid: 'testProfileUid',
  } as unknown as AuthenticatedUser;
  const dependencies = {} as unknown as SiemMigrationsClientDependencies;

  beforeEach(() => {
    client = new TestSiemMigrationsDataItemClient(
      indexNameProvider,
      currentUser,
      esClient,
      logger,
      dependencies
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getStats', () => {
    it('queries ES using isEligibleForTranslation filter', async () => {
      (esClient.asInternalUser.esql.query as jest.Mock).mockResolvedValueOnce({
        columns: [],
        values: [],
      });

      const stats = await client.getStats('mig-1');

      expect(esClient.asInternalUser.esql.query).toHaveBeenCalledWith({
        query:
          'FROM .kibana-siem-rule-migrations-rules-default | STATS items = COUNT(*), createdAt = MIN(@timestamp), lastUpdatedAt = MAX(updated_at) BY status | LIMIT 10000',
        filter: {
          bool: {
            filter: [{ term: { migration_id: 'mig-1' } }, dsl.isEligibleForTranslation()],
          },
        },
      });
      expect(stats).toMatchObject({ items: { total: 0 }, created_at: '', last_updated_at: '' });
    });
  });

  describe('getAllStats', () => {
    it('queries ES using eligibility filter', async () => {
      (esClient.asInternalUser.esql.query as jest.Mock).mockResolvedValueOnce({
        columns: [],
        values: [],
      });

      await client.getAllStats();

      expect(esClient.asInternalUser.esql.query).toHaveBeenCalledWith({
        query:
          'FROM .kibana-siem-rule-migrations-rules-default | STATS items = COUNT(*), createdAt = MIN(@timestamp), lastUpdatedAt = MAX(updated_at) BY migration_id, status | LIMIT 10000',
        filter: { bool: { filter: [dsl.isEligibleForTranslation()] } },
      });
    });

    it('returns the migrations in creation order with their counts by status', async () => {
      (esClient.asInternalUser.esql.query as jest.Mock).mockResolvedValueOnce({
        columns: [
          { name: 'items', type: 'long' },
          { name: 'createdAt', type: 'date' },
          { name: 'lastUpdatedAt', type: 'date' },
          { name: 'migration_id', type: 'keyword' },
          { name: 'status', type: 'keyword' },
        ],
        values: [
          [4, '2025-02-01T00:00:00.000Z', '2025-02-03T00:00:00.000Z', 'late', 'completed'],
          [1, '2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z', 'early', 'pending'],
          [2, '2025-01-05T00:00:00.000Z', '2025-01-09T00:00:00.000Z', 'early', 'failed'],
        ],
      });

      const stats = await client.getAllStats();

      expect(
        stats.map(({ id, items, created_at: createdAt, last_updated_at: updatedAt }) => ({
          id,
          items,
          createdAt,
          updatedAt,
        }))
      ).toEqual([
        {
          id: 'early',
          items: { total: 3, pending: 1, processing: 0, completed: 0, failed: 2 },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-09T00:00:00.000Z',
        },
        {
          id: 'late',
          items: { total: 4, pending: 0, processing: 0, completed: 4, failed: 0 },
          createdAt: '2025-02-01T00:00:00.000Z',
          updatedAt: '2025-02-03T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('searchBatches', () => {
    it('rolls forward PIT id between pages', async () => {
      (esClient.asInternalUser.openPointInTime as jest.Mock).mockResolvedValue({ id: 'pit-1' });

      const searchMock = esClient.asInternalUser.search as unknown as jest.MockedFn<
        typeof SearchApi
      >;
      searchMock
        .mockResolvedValueOnce({
          pit_id: 'pit-2',
          hits: {
            total: { value: 2 },
            hits: [
              { _id: '1', _source: { migration_id: 'mig-1' }, sort: ['a'] },
              { _id: '2', _source: { migration_id: 'mig-1' }, sort: ['b'] },
            ],
          },
        } as unknown as SearchApiResponse)
        .mockResolvedValueOnce({
          pit_id: 'pit-3',
          hits: {
            total: { value: 0 },
            hits: [],
          },
        } as unknown as SearchApiResponse);

      const { next } = client.searchBatches('mig-1');

      const firstPage = await next();
      expect(firstPage).toHaveLength(2);
      expect(searchMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ pit: { id: 'pit-1', keep_alive: '30s' } })
      );

      const secondPage = await next();
      expect(secondPage).toEqual([]);
      expect(searchMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          pit: { id: 'pit-2', keep_alive: '30s' },
          search_after: ['b'],
        })
      );

      const thirdPage = await next();
      expect(thirdPage).toEqual([]);
      expect(searchMock).toHaveBeenCalledTimes(2);
    });
  });
});
