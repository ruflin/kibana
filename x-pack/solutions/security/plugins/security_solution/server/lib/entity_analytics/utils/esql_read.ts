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
import { isResponseError } from '@kbn/es-errors';
import type { ESQLSearchResponse } from '@kbn/es-types';

/*
 * Shared plumbing for the Entity Analytics reads that moved from the Query DSL to ES|QL.
 *
 * - A missing index is an error in ES|QL (400 `verification_exception`, `Unknown index`), where the
 *   DSL reads used `ignore_unavailable`. `runEsqlRead` returns `undefined` for it with
 *   `tolerateMissingIndex`, and callers return their empty result.
 * - The composer's named parameters go in the request body. A clause that ES|QL cannot filter
 *   exactly (multi-valued or `text` fields) goes in the request `filter`, which stays Query DSL.
 */

/** One row of an ES|QL response, keyed by column name. */
export type EsqlRow = Record<string, unknown>;

export const isEsqlUnknownIndexError = (error: unknown): boolean => {
  if (!isResponseError(error) || error.statusCode !== 400) return false;
  const details = (error.body as { error?: { type?: string; reason?: string } } | undefined)?.error;
  return (
    details?.type === 'verification_exception' && (details.reason ?? '').includes('Unknown index')
  );
};

export const runEsqlRead = async ({
  esClient,
  query,
  filter,
  signal,
  tolerateMissingIndex = false,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
  signal?: AbortSignal;
  /** Return `undefined` instead of failing when the index does not exist. */
  tolerateMissingIndex?: boolean;
}): Promise<ESQLSearchResponse | undefined> => {
  const { filter: _composerFilter, ...request } = query.toRequest();
  try {
    return (await esClient.esql.query(
      { ...(request as unknown as EsqlQueryRequest), ...(filter ? { filter } : {}) },
      { signal }
    )) as unknown as ESQLSearchResponse;
  } catch (error) {
    if (tolerateMissingIndex && isEsqlUnknownIndexError(error)) {
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

/** The `total` of a `STATS total = COUNT(*)` response, `0` when there is no row. */
export const esqlCount = (response: ESQLSearchResponse | undefined): number => {
  const value = esqlRows(response)[0]?.total;
  return typeof value === 'number' ? value : 0;
};
