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
import type { ComposerQuery } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { ESQLSearchResponse } from '@kbn/es-types';
import { isEsqlUnknownIndexError } from '@kbn/storage-adapter';

/*
 * Shared plumbing for the Nightshift reads that moved from the Query DSL to ES|QL.
 *
 * Two things differ from the DSL and every caller needs them:
 * - A missing index is an error in ES|QL (400 `verification_exception`, `Unknown index`), where the
 *   DSL searches used `ignore_unavailable`. `runEsqlRead` returns `undefined` for it, and callers
 *   return their empty result.
 * - The composer's named parameters go in the request body, and any term clause that must be
 *   exact on a multi-valued or flattened field goes in the request `filter`, not in `WHERE`.
 */

const toEsqlRequest = (query: ComposerQuery): EsqlQueryRequest => {
  const { filter: _composerFilter, ...rest } = query.toRequest();
  return rest as unknown as EsqlQueryRequest;
};

/** One row of an ES|QL response, keyed by column name. */
export type EsqlRow = Record<string, unknown>;

export const runEsqlRead = async ({
  esClient,
  query,
  filter,
  signal,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
  signal?: AbortSignal;
}): Promise<ESQLSearchResponse | undefined> => {
  try {
    return (await esClient.esql.query(
      { ...toEsqlRequest(query), ...(filter ? { filter } : {}) },
      { signal }
    )) as unknown as ESQLSearchResponse;
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) {
      return undefined;
    }
    throw error;
  }
};

/** The rows of a response as objects keyed by column name. An absent response has no rows. */
export const esqlRows = (response: ESQLSearchResponse | undefined): EsqlRow[] => {
  if (!response) return [];
  const names = response.columns.map((column) => column.name);
  return response.values.map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index]]))
  );
};

/** The `_source` object of each row, skipping rows without one. */
export const esqlSources = <T>(response: ESQLSearchResponse | undefined): T[] =>
  esqlRows(response).flatMap((row) =>
    row._source !== null && typeof row._source === 'object' ? [row._source as T] : []
  );

/** The `total` of a `STATS total = COUNT(*)` response, `0` when there is no row. */
export const esqlCount = (response: ESQLSearchResponse | undefined): number => {
  const value = esqlRows(response)[0]?.total;
  return typeof value === 'number' ? value : 0;
};
