/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  EsqlQueryRequest,
  QueryDslQueryContainer,
} from '@elastic/elasticsearch/lib/api/types';
import { esql, type ComposerQuery } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { ESQLSearchResponse } from '@kbn/es-types';
import { MEMORY_INDEX, type StoredMemoryPage } from '../../common/memory';

/*
 * ES|QL reads of the Semantic Memory index. Three properties of the managed AI index shape them:
 *
 * - `attributes` is `flattened`. ES|QL cannot filter or sort on its subfields, only read them with
 *   `FIELD_EXTRACT`. So the space, tag and archived clauses are not `WHERE` predicates: they are the
 *   request `filter` (Query DSL), which Elasticsearch applies as a Lucene pre-filter. That keeps the
 *   space isolation exact, and the semantic branch of the hybrid search ranks inside the space.
 * - `_source` is not available after `FORK` or `FUSE`, so hybrid search returns ranked ids only.
 * - The flattened `attributes` column returns every value as a string, so it cannot stand in for
 *   `_source`.
 */

const SORT_UPDATED_AT_COLUMN = 'sort_updated_at';
const SORT_SLUG_COLUMN = 'sort_slug';

export type MemoryKeysetCursor = readonly [updatedAt: string, slug: string];

export interface MemoryRow {
  id: string;
  source: StoredMemoryPage;
  /** Keyset position of the row, present when the query returns the sort columns. */
  sort?: MemoryKeysetCursor;
}

const memoryPages = (columns: string[]): ComposerQuery => esql.from([MEMORY_INDEX], columns);

const withSortColumns = (query: ComposerQuery): ComposerQuery =>
  query.pipe`EVAL sort_updated_at = FIELD_EXTRACT(attributes, "updated_at"), sort_slug = FIELD_EXTRACT(attributes, "slug")`;

// Newest first, slug as the tiebreaker: the order is total, so keyset paging never skips a row.
const sortedByRecency = (query: ComposerQuery): ComposerQuery =>
  query.pipe`SORT sort_updated_at DESC NULLS LAST, sort_slug ASC NULLS LAST`.keep(
    '_id',
    '_source',
    SORT_UPDATED_AT_COLUMN,
    SORT_SLUG_COLUMN
  );

// Same as `multi_match` with `operator: and`: every term in one field, any of the fields.
const matchAllTerms = (query: ComposerQuery, text: string): ComposerQuery =>
  query.where`MATCH(title, ${{ text }}, {"operator": "AND"}) OR MATCH(description, ${{
    text,
  }}, {"operator": "AND"})`;

export const buildListQuery = (limit: number): ComposerQuery =>
  sortedByRecency(withSortColumns(memoryPages(['_id', '_source']))).limit(limit);

export const buildPageQuery = ({
  pageSize,
  search,
  cursor,
}: {
  pageSize: number;
  search?: string;
  cursor?: MemoryKeysetCursor;
}): ComposerQuery => {
  let query = withSortColumns(memoryPages(['_id', '_source']));
  if (search) {
    query = matchAllTerms(query, search);
  }
  if (cursor) {
    const [cursorUpdatedAt, cursorSlug] = cursor;
    query = query.where`sort_updated_at < ${{ cursorUpdatedAt }} OR (sort_updated_at == ${{
      cursorUpdatedAt,
    }} AND sort_slug > ${{ cursorSlug }})`;
  }
  return sortedByRecency(query).limit(pageSize);
};

/** Counts the pages the request filter (and `search`, when given) matches. */
export const buildCountQuery = ({ search }: { search?: string } = {}): ComposerQuery => {
  const query = memoryPages([]);
  return (search ? matchAllTerms(query, search) : query).pipe`STATS total = COUNT(*)`;
};

export const buildContentSearchQuery = ({
  text,
  size,
}: {
  text: string;
  size: number;
}): ComposerQuery =>
  memoryPages(['_id', '_source', '_score']).where`MATCH(title, ${{ text }}) OR MATCH(content, ${{
    text,
  }})`.pipe`SORT _score DESC, _id ASC`
    .keep('_id', '_source', '_score')
    .limit(size);

export const buildDescriptionSearchQuery = ({
  text,
  size,
}: {
  text: string;
  size: number;
}): ComposerQuery =>
  memoryPages(['_id', '_source', '_score']).where`MATCH(description, ${{ text }})`
    .pipe`SORT _score DESC, _id ASC`
    .keep('_id', '_source', '_score')
    .limit(size);

// `MATCH` is the first command of each branch, before the branch `LIMIT`. After a `LIMIT` it would
// be a runtime search that does not contribute to `_score`. 60 is the default `rank_constant` of
// `FUSE RRF` and of the `rrf` retriever.
export const buildHybridQuery = ({ text, size }: { text: string; size: number }): ComposerQuery =>
  memoryPages(['_id', '_index', '_score']).pipe`FORK (WHERE MATCH(description, ${{
    text,
  }}) | SORT _score DESC | LIMIT ${{ window: size }}) (WHERE MATCH(description.semantic, ${{
    text,
  }}) | SORT _score DESC | LIMIT ${{ window: size }})`.pipe`FUSE RRF WITH {"rank_constant": 60}`
    .pipe`SORT _score DESC, _id ASC`
    .keep('_id')
    .limit(size);

export const buildRecentQuery = (size: number): ComposerQuery =>
  memoryPages(['_id', '_source']).pipe`SORT @timestamp DESC NULLS LAST`
    .keep('_id', '_source')
    .limit(size);

const toEsqlRequest = (query: ComposerQuery): EsqlQueryRequest => {
  const { filter: _composerFilter, ...rest } = query.toRequest();
  return rest as unknown as EsqlQueryRequest;
};

/** Runs `query`, applying `filter` (Query DSL) as the Lucene pre-filter. */
export const runMemoryEsql = async ({
  esClient,
  query,
  filter,
  signal,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter: QueryDslQueryContainer;
  signal?: AbortSignal;
}): Promise<ESQLSearchResponse> =>
  (await esClient.esql.query(
    { ...toEsqlRequest(query), filter },
    { signal }
  )) as unknown as ESQLSearchResponse;

const columnIndex = (response: ESQLSearchResponse, name: string): number =>
  response.columns.findIndex((column) => column.name === name);

export const idsOf = (response: ESQLSearchResponse): string[] => {
  const idIndex = columnIndex(response, '_id');
  if (idIndex === -1) return [];
  return response.values.flatMap((row) => {
    const id = row[idIndex];
    return typeof id === 'string' ? [id] : [];
  });
};

export const rowsOf = (response: ESQLSearchResponse): MemoryRow[] => {
  const idIndex = columnIndex(response, '_id');
  const sourceIndex = columnIndex(response, '_source');
  const updatedAtIndex = columnIndex(response, SORT_UPDATED_AT_COLUMN);
  const slugIndex = columnIndex(response, SORT_SLUG_COLUMN);
  if (idIndex === -1 || sourceIndex === -1) return [];

  return response.values.flatMap((row) => {
    const id = row[idIndex];
    const source = row[sourceIndex];
    if (typeof id !== 'string' || source === null || typeof source !== 'object') return [];

    const updatedAt = updatedAtIndex === -1 ? undefined : row[updatedAtIndex];
    const slug = slugIndex === -1 ? undefined : row[slugIndex];
    const sort: MemoryKeysetCursor | undefined =
      typeof updatedAt === 'string' && typeof slug === 'string' ? [updatedAt, slug] : undefined;
    return [{ id, source: source as StoredMemoryPage, ...(sort ? { sort } : {}) }];
  });
};

/** The number a `STATS total = COUNT(*)` query returns, `0` when there is no row. */
export const countOf = (response: ESQLSearchResponse): number => {
  const index = columnIndex(response, 'total');
  const value = index === -1 ? undefined : response.values[0]?.[index];
  return typeof value === 'number' ? value : 0;
};
