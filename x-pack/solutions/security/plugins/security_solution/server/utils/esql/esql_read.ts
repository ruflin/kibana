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
 * Shared plumbing for the server reads that moved from the Query DSL to ES|QL.
 *
 * A missing index is an error in ES|QL (400 `verification_exception`, `Unknown index`), where the
 * DSL searches used `ignore_unavailable`. `runEsqlRead` returns `undefined` for it, and callers
 * return their empty result.
 */

/** One row of an ES|QL response, keyed by column name. */
export type EsqlRow = Record<string, unknown>;

/** Matches the error ES|QL returns when none of the requested indices exists. */
// The composer prints a source name into `FROM` as it is. A plain name is a (remote cluster
// prefixed) index, alias, data stream or wildcard pattern: no `|`, quote, space, newline or comma,
// and no leading `_`, `-` or `+`.
const PLAIN_ESQL_SOURCE = /^[A-Za-z0-9.*][A-Za-z0-9._*:+-]*$/;
const MAX_ESQL_SOURCE_LENGTH = 255;

/** Whether `source` is safe to pass to `esql.from` as one source, e.g. a name from a request. */
export const isPlainEsqlSource = (source: string): boolean =>
  source.length <= MAX_ESQL_SOURCE_LENGTH && PLAIN_ESQL_SOURCE.test(source);

export const isEsqlUnknownIndexError = (error: unknown): boolean => {
  if (!isResponseError(error) || error.statusCode !== 400) return false;
  const body = error.body as { error?: { type?: string; reason?: string } } | undefined;
  return (
    body?.error?.type === 'verification_exception' &&
    typeof body.error.reason === 'string' &&
    body.error.reason.includes('Unknown index')
  );
};

const toEsqlRequest = (query: ComposerQuery): EsqlQueryRequest => {
  const { filter: _composerFilter, ...rest } = query.toRequest();
  return rest as unknown as EsqlQueryRequest;
};

/**
 * Runs a composed ES|QL query. `filter` is a Query DSL clause applied before the query, for terms
 * that cannot be written as a plain `WHERE` (multi-valued, flattened or text fields).
 * Resolves `undefined` when the index does not exist and `tolerateUnknownIndex` is set.
 */
export const runEsqlRead = async ({
  esClient,
  query,
  filter,
  signal,
  requestTimeout,
  tolerateUnknownIndex = true,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
  signal?: AbortSignal;
  requestTimeout?: number;
  tolerateUnknownIndex?: boolean;
}): Promise<ESQLSearchResponse | undefined> => {
  try {
    return (await esClient.esql.query(
      { ...toEsqlRequest(query), ...(filter ? { filter } : {}) },
      { signal, requestTimeout }
    )) as unknown as ESQLSearchResponse;
  } catch (error) {
    if (tolerateUnknownIndex && isEsqlUnknownIndexError(error)) {
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

/** A numeric cell as a number, `0` for a null or non-numeric one. */
export const toCount = (value: unknown): number => (typeof value === 'number' ? value : 0);

/**
 * The placeholders and named parameters of a value list, for `field IN (...)`: ES|QL has no
 * array parameter, so each value is bound on its own. Build the query with `esql(text, params)`.
 */
export const toInListParams = (
  prefix: string,
  values: readonly (string | number)[]
): { placeholders: string; params: Record<string, string | number> } => ({
  placeholders: values.map((_, index) => `?${prefix}${index}`).join(', '),
  params: Object.fromEntries(values.map((value, index) => [`${prefix}${index}`, value])),
});
