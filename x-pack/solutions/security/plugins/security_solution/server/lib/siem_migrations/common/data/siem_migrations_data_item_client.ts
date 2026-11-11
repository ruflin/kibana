/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import type {
  AggregationsStringTermsAggregate,
  AggregationsStringTermsBucket,
  BulkOperationContainer,
  Duration,
  QueryDslQueryContainer,
} from '@elastic/elasticsearch/lib/api/types';
import type { estypes } from '@elastic/elasticsearch';
import { esql } from '@elastic/esql';
import type { SiemMigrationVendor } from '../../../../../common/siem_migrations/model/common.gen';
import type {
  MigrationType,
  SiemMigrationFilters,
} from '../../../../../common/siem_migrations/types';
import type { ItemDocument, Stored } from '../types';
import {
  SiemMigrationStatus,
  MigrationTranslationResult,
} from '../../../../../common/siem_migrations/constants';
import { SiemMigrationsDataBaseClient } from './siem_migrations_data_base_client';
import { MAX_ES_SEARCH_SIZE } from './constants';
import type {
  SiemMigrationAllDataStats,
  SiemMigrationDataStats,
  SiemMigrationGetItemsOptions,
  SiemMigrationSort,
} from './types';
import { dsl } from './dsl_queries';
import type { EsqlRow } from '../../../esql/esql_read';
import { esqlRows, runEsql } from '../../../esql/esql_read';

export type CreateMigrationItemInput<I extends ItemDocument> = Omit<
  I,
  '@timestamp' | 'id' | 'status' | 'created_by' | 'updated_by' | 'updated_at'
>;

/* BULK_MAX_SIZE defines the number to break down the bulk operations by.
 * The 500 number was chosen as a reasonable number to avoid large payloads. It can be adjusted if needed. */
const BULK_MAX_SIZE = 500 as const;
/* DEFAULT_SEARCH_BATCH_SIZE defines the default number of documents to retrieve per search operation
 * when retrieving search results in batches. */
const DEFAULT_SEARCH_BATCH_SIZE = 500 as const;

export abstract class SiemMigrationsDataItemClient<
  I extends ItemDocument = ItemDocument
> extends SiemMigrationsDataBaseClient {
  protected abstract type: MigrationType;
  public abstract getVendor(migrationId: string): Promise<SiemMigrationVendor | undefined>;

  /** Indexes an array of migration items in pending status */
  async create(items: CreateMigrationItemInput<I>[]): Promise<void> {
    const index = await this.getIndexName();
    const profileId = await this.getProfileUid();

    const createdAt = new Date().toISOString();

    const batches: CreateMigrationItemInput<I>[][] = [];
    for (let i = 0; i < items.length; i += BULK_MAX_SIZE) {
      batches.push(items.slice(i, i + BULK_MAX_SIZE));
    }

    await Promise.all(
      batches.map((itemsSlice) =>
        this.esClient
          .bulk({
            refresh: 'wait_for',
            operations: itemsSlice.flatMap((item) => [
              { create: { _index: index } },
              {
                ...item,
                '@timestamp': createdAt,
                status: SiemMigrationStatus.PENDING,
                created_by: profileId,
                updated_by: profileId,
                updated_at: createdAt,
              },
            ]),
          })
          .catch((error) => {
            this.logger.error(`Error creating migration ${this.type}: ${error.message}`);
            throw error;
          })
      )
    );
  }

  /** Updates an array of migration items */
  async update<U extends Partial<ItemDocument>>(itemsUpdate: U[]): Promise<void> {
    const index = await this.getIndexName();
    const profileId = await this.getProfileUid();

    const updatedAt = new Date().toISOString();
    const batches: U[][] = [];
    for (let i = 0; i < itemsUpdate.length; i += BULK_MAX_SIZE) {
      batches.push(itemsUpdate.slice(i, i + BULK_MAX_SIZE));
    }

    const batchPromises = batches.map((itemsUpdateSlice) =>
      this.esClient
        .bulk({
          refresh: 'wait_for',
          operations: itemsUpdateSlice.flatMap((item) => {
            const { id, ...rest } = item;
            return [
              { update: { _index: index, _id: id } },
              {
                doc: {
                  ...rest,
                  updated_by: profileId,
                  updated_at: updatedAt,
                },
              },
            ];
          }),
        })
        .catch((error) => {
          this.logger.error(`Error updating migration ${this.type}: ${error.message}`);
          throw error;
        })
    );

    await Promise.all(batchPromises);
  }

  /** Retrieves an array of migration items of a specific migration */
  async get(
    migrationId: string,
    { filters = {}, sort: sortParam = {}, from, size }: SiemMigrationGetItemsOptions = {}
  ): Promise<{ total: number; data: Stored<I>[] }> {
    const index = await this.getIndexName();
    const query = this.getFilterQuery(migrationId, filters);
    const sort = this.getSortOptions(sortParam);

    const result = await this.esClient
      .search<I>({ index, query, sort, from, size })
      .catch((error) => {
        this.logger.error(`Error searching migration ${this.type}: ${error.message}`);
        throw error;
      });
    return {
      total: this.getTotalHits(result),
      data: this.processResponseHits(result),
    };
  }

  async getByQuery(
    migrationId: string,
    { queryDSL, from, size }: { queryDSL: object; from?: number; size?: number }
  ): Promise<{ total: number; data: Stored<I>[] }> {
    const index = await this.getIndexName();
    const baseQuery = this.getFilterQuery(migrationId, {});
    const combinedQuery = {
      bool: {
        must: [baseQuery, queryDSL],
      },
    };
    const result = await this.esClient
      .search<I>({ index, query: combinedQuery, from, size })
      .catch((error) => {
        this.logger.error(`Error searching migration ${this.type} by query: ${error.message}`);
        throw error;
      });
    return {
      total: this.getTotalHits(result),
      data: this.processResponseHits(result),
    };
  }

  /** Prepares bulk ES delete operations for the migration items based on migrationId. */
  public async prepareDelete(migrationId: string): Promise<BulkOperationContainer[]> {
    const index = await this.getIndexName();
    const itemsToBeDeleted = await this.get(migrationId, { size: MAX_ES_SEARCH_SIZE });
    const itemsToBeDeletedDocIds = itemsToBeDeleted.data.map((item) => item.id);

    return itemsToBeDeletedDocIds.map((docId) => ({
      delete: { _index: index, _id: docId },
    }));
  }

  /** Returns batching functions to traverse all the migration items search results */
  public searchBatches(
    migrationId: string,
    options: { scroll?: Duration; size?: number; filters?: object } = {}
  ) {
    const { size = DEFAULT_SEARCH_BATCH_SIZE, filters = {}, scroll } = options;
    const query = this.getFilterQuery(migrationId, filters);
    const search = { query, sort: '_doc', scroll, size }; // sort by _doc to ensure consistent order
    try {
      return this.getSearchBatches<I>(search);
    } catch (error) {
      this.logger.error(`Error scrolling migration ${this.type}: ${error.message}`);
      throw error;
    }
  }

  /** Retrieves the stats for the migrations items with the provided id */
  public async getStats(migrationId: string): Promise<SiemMigrationDataStats> {
    const index = await this.getIndexName();
    const filter = this.getFilterQuery(migrationId, { isEligibleForTranslation: true });

    const vendor = await this.getVendor(migrationId);
    const response = await runEsql({
      esClient: this.esClient,
      query: esql.from([index])
        .pipe`STATS items = COUNT(*), createdAt = MIN(@timestamp), lastUpdatedAt = MAX(updated_at) BY status`.limit(
        MAX_ES_SEARCH_SIZE
      ),
      filter,
    }).catch((error) => {
      this.logger.error(`Error getting migration ${this.type} stats: ${error.message}`);
      throw error;
    });

    const [stats] = this.toMigrationStats(esqlRows(response));
    return {
      id: migrationId,
      items: {
        total: stats?.total ?? 0,
        ...(stats?.statusCounts ?? this.statusCounts([])),
      },
      created_at: stats?.createdAt ?? '',
      last_updated_at: stats?.lastUpdatedAt ?? '',
      vendor,
    };
  }

  /** Retrieves the stats for all the migration items aggregated by migration id, in creation order */
  async getAllStats(): Promise<SiemMigrationAllDataStats> {
    const index = await this.getIndexName();
    const filter = this.getFilterQuery(undefined, { isEligibleForTranslation: true });
    const response = await runEsql({
      esClient: this.esClient,
      query: esql.from([index])
        .pipe`STATS items = COUNT(*), createdAt = MIN(@timestamp), lastUpdatedAt = MAX(updated_at) BY migration_id, status`.limit(
        MAX_ES_SEARCH_SIZE
      ),
      filter,
    }).catch((error) => {
      this.logger.error(`Error getting all migration ${this.type} stats: ${error.message}`);
      throw error;
    });

    const migrations = this.toMigrationStats(esqlRows(response), 'migration_id')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, MAX_ES_SEARCH_SIZE);
    const vendors = await Promise.all(
      migrations.map(async (migration) => this.getVendor(migration.id))
    );
    return migrations.map<SiemMigrationDataStats>((migration, idx) => ({
      id: migration.id,
      vendor: vendors[idx],
      items: {
        total: migration.total,
        ...migration.statusCounts,
      },
      created_at: migration.createdAt,
      last_updated_at: migration.lastUpdatedAt,
    }));
  }

  /**
   * Folds the `STATS ... BY [migration_id,] status` rows into one entry per migration, with the
   * item counts by status and the earliest creation and latest update.
   */
  private toMigrationStats(rows: EsqlRow[], idColumn?: string) {
    const rowsByMigration = new Map<string, EsqlRow[]>();
    for (const row of rows) {
      const id = idColumn ? `${row[idColumn]}` : '';
      rowsByMigration.set(id, [...(rowsByMigration.get(id) ?? []), row]);
    }
    return [...rowsByMigration].map(([id, migrationRows]) => {
      const dates = (column: string) =>
        migrationRows.flatMap((row) => (typeof row[column] === 'string' ? [`${row[column]}`] : []));
      const createdAt = dates('createdAt').sort()[0] ?? '';
      const lastUpdatedAt = dates('lastUpdatedAt').sort().reverse()[0] ?? '';
      const statusCounts = this.statusCounts(migrationRows);
      return {
        id,
        total: migrationRows.reduce((sum, row) => sum + Number(row.items ?? 0), 0),
        statusCounts,
        createdAt,
        lastUpdatedAt,
      };
    });
  }

  private statusCounts(rows: EsqlRow[]): Record<SiemMigrationStatus, number> {
    const countOf = (status: SiemMigrationStatus) =>
      rows.find((row) => row.status === status)?.items;
    return {
      [SiemMigrationStatus.PENDING]: Number(countOf(SiemMigrationStatus.PENDING) ?? 0),
      [SiemMigrationStatus.PROCESSING]: Number(countOf(SiemMigrationStatus.PROCESSING) ?? 0),
      [SiemMigrationStatus.COMPLETED]: Number(countOf(SiemMigrationStatus.COMPLETED) ?? 0),
      [SiemMigrationStatus.FAILED]: Number(countOf(SiemMigrationStatus.FAILED) ?? 0),
    };
  }

  /** Updates one migration item status to `processing` */
  public async saveProcessing(id: string): Promise<void> {
    const index = await this.getIndexName();
    const profileId = await this.getProfileUid();
    const doc = {
      status: SiemMigrationStatus.PROCESSING,
      updated_by: profileId,
      updated_at: new Date().toISOString(),
    };
    await this.esClient.update({ index, id, doc, refresh: 'wait_for' }).catch((error) => {
      this.logger.error(
        `Error updating migration ${this.type} status to processing: ${error.message}`
      );
      throw error;
    });
  }

  /** Updates one migration item with the provided data and sets the status to `completed` */
  public async saveCompleted({ id, ...migrationItem }: Stored<I>): Promise<void> {
    const index = await this.getIndexName();
    const profileId = await this.getProfileUid();
    const doc = {
      ...migrationItem,
      status: SiemMigrationStatus.COMPLETED,
      updated_by: profileId,
      updated_at: new Date().toISOString(),
    };
    await this.esClient.update({ index, id, doc, refresh: 'wait_for' }).catch((error) => {
      this.logger.error(
        `Error updating migration ${this.type} status to completed: ${error.message}`
      );
      throw error;
    });
  }

  /** Updates one migration item with the provided data and sets the status to `failed` */
  public async saveError({ id, ...migrationItem }: Stored<I>): Promise<void> {
    const index = await this.getIndexName();
    const profileId = await this.getProfileUid();
    const doc = {
      ...migrationItem,
      status: SiemMigrationStatus.FAILED,
      updated_by: profileId,
      updated_at: new Date().toISOString(),
    };
    await this.esClient.update({ index, id, doc, refresh: 'wait_for' }).catch((error) => {
      this.logger.error(`Error updating migration ${this.type} status to failed: ${error.message}`);
      throw error;
    });
  }

  /** Updates all the migration items with the provided id with status `processing` back to `pending` */
  public async releaseProcessing(migrationId: string): Promise<void> {
    return this.updateStatus(
      migrationId,
      { status: SiemMigrationStatus.PROCESSING },
      SiemMigrationStatus.PENDING
    );
  }

  /** Updates all the migration items with the provided id and with status `statusToQuery` to `statusToUpdate` */
  public async updateStatus(
    migrationId: string,
    filter: object,
    statusToUpdate: SiemMigrationStatus,
    { refresh = false }: { refresh?: boolean } = {}
  ): Promise<void> {
    const index = await this.getIndexName();
    const query = this.getFilterQuery(migrationId, filter);
    const script = { source: `ctx._source['status'] = '${statusToUpdate}'` };
    await this.esClient.updateByQuery({ index, query, script, refresh }).catch((error) => {
      this.logger.error(`Error updating migration ${this.type} status: ${error.message}`);
      throw error;
    });
  }

  protected getVendorFromAggs(vendorAgg: AggregationsStringTermsAggregate): string {
    const buckets = vendorAgg.buckets as AggregationsStringTermsBucket[];
    return buckets[0]?.key?.toString() ?? 'unknown';
  }

  protected statusAggCounts(
    statusAgg: AggregationsStringTermsAggregate
  ): Record<SiemMigrationStatus, number> {
    const buckets = statusAgg.buckets as AggregationsStringTermsBucket[];
    return {
      [SiemMigrationStatus.PENDING]:
        buckets.find(({ key }) => key === SiemMigrationStatus.PENDING)?.doc_count ?? 0,
      [SiemMigrationStatus.PROCESSING]:
        buckets.find(({ key }) => key === SiemMigrationStatus.PROCESSING)?.doc_count ?? 0,
      [SiemMigrationStatus.COMPLETED]:
        buckets.find(({ key }) => key === SiemMigrationStatus.COMPLETED)?.doc_count ?? 0,
      [SiemMigrationStatus.FAILED]:
        buckets.find(({ key }) => key === SiemMigrationStatus.FAILED)?.doc_count ?? 0,
    };
  }

  protected translationResultAggCount(
    resultAgg: AggregationsStringTermsAggregate
  ): Record<MigrationTranslationResult, number> {
    const buckets = resultAgg.buckets as AggregationsStringTermsBucket[];
    return {
      [MigrationTranslationResult.FULL]:
        buckets.find(({ key }) => key === MigrationTranslationResult.FULL)?.doc_count ?? 0,
      [MigrationTranslationResult.PARTIAL]:
        buckets.find(({ key }) => key === MigrationTranslationResult.PARTIAL)?.doc_count ?? 0,
      [MigrationTranslationResult.UNTRANSLATABLE]:
        buckets.find(({ key }) => key === MigrationTranslationResult.UNTRANSLATABLE)?.doc_count ??
        0,
    };
  }

  protected getFilterQuery(
    migrationId?: string,
    filters: SiemMigrationFilters = {}
  ): { bool: { filter: QueryDslQueryContainer[] } } {
    const filter: QueryDslQueryContainer[] = [];

    if (migrationId) {
      filter.push({ term: { migration_id: migrationId } });
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        filter.push({ terms: { status: filters.status } });
      } else {
        filter.push({ term: { status: filters.status } });
      }
    }
    if (filters.ids) {
      filter.push({ terms: { _id: filters.ids } });
    }
    if (filters.failed != null) {
      filter.push(filters.failed ? dsl.isFailed() : dsl.isNotFailed());
    }
    if (filters.fullyTranslated != null) {
      filter.push(filters.fullyTranslated ? dsl.isFullyTranslated() : dsl.isNotFullyTranslated());
    }
    if (filters.partiallyTranslated != null) {
      filter.push(
        filters.partiallyTranslated ? dsl.isPartiallyTranslated() : dsl.isNotPartiallyTranslated()
      );
    }
    if (filters.untranslatable != null) {
      filter.push(filters.untranslatable ? dsl.isUntranslatable() : dsl.isNotUntranslatable());
    }

    if (filters.isEligibleForTranslation) {
      filter.push(dsl.isEligibleForTranslation());
    }
    return { bool: { filter } };
  }

  protected abstract getSortOptions(sort?: SiemMigrationSort): estypes.Sort;
}
