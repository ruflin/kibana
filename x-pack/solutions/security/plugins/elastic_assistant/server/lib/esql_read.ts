/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  EsqlQueryRequest,
  EsqlQueryResponse,
  QueryDslQueryContainer,
} from '@elastic/elasticsearch/lib/api/types';
import type { ComposerQuery } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';

/**
 * A missing index is an error in ES|QL (400 `verification_exception`, `Unknown index`), where the
 * Query DSL searches that used `ignore_unavailable` returned an empty result.
 */
// The composer prints a source name into `FROM` as it is. A plain name is a (remote cluster
// prefixed) index, alias, data stream or wildcard pattern: no `|`, quote, space, newline or comma,
// and no leading `_`, `-` or `+`.
const PLAIN_ESQL_SOURCE = /^[A-Za-z0-9.*][A-Za-z0-9._*:+-]*$/;
const MAX_ESQL_SOURCE_LENGTH = 255;

const splitSources = (indexPattern: string): string[] =>
  indexPattern
    .split(',')
    .map((source) => source.trim())
    .filter((source) => source.length > 0);

/** Whether a comma separated index pattern, e.g. from a request, only holds plain source names. */
export const isPlainEsqlIndexPattern = (indexPattern: string): boolean => {
  const sources = splitSources(indexPattern);
  return (
    sources.length > 0 &&
    sources.every(
      (source) => source.length <= MAX_ESQL_SOURCE_LENGTH && PLAIN_ESQL_SOURCE.test(source)
    )
  );
};

/** The sources of an ES|QL `FROM` for a comma separated index pattern. Throws on an unsafe name. */
export const toEsqlSources = (indexPattern: string): string[] => {
  if (!isPlainEsqlIndexPattern(indexPattern)) {
    throw new Error(`Invalid index name or pattern: ${indexPattern.slice(0, 80)}`);
  }
  return splitSources(indexPattern);
};

export const isEsqlUnknownIndexError = (error: unknown): boolean => {
  const responseError = error as
    | { statusCode?: number; body?: { error?: { type?: string; reason?: string } } }
    | undefined;
  return (
    responseError?.statusCode === 400 &&
    responseError.body?.error?.type === 'verification_exception' &&
    typeof responseError.body.error.reason === 'string' &&
    responseError.body.error.reason.includes('Unknown index')
  );
};

/** One row of an ES|QL response, keyed by column name. */
export type EsqlRow = Record<string, unknown>;

/**
 * Runs a composed ES|QL query. The composer's named parameters go in the request, and `filter`
 * carries any Query DSL clause that cannot be a plain `WHERE`. With `ignoreUnknownIndex` an unknown
 * index gives `undefined`, like `ignore_unavailable` gave an empty search result.
 */
export const runEsql = async ({
  esClient,
  query,
  filter,
  ignoreUnknownIndex = false,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
  ignoreUnknownIndex?: boolean;
}): Promise<EsqlQueryResponse | undefined> => {
  const { query: text, params } = query.toRequest();
  const request = {
    query: text,
    ...(params?.length ? { params } : {}),
    ...(filter ? { filter } : {}),
  } as EsqlQueryRequest;
  try {
    return await esClient.esql.query(request);
  } catch (error) {
    if (ignoreUnknownIndex && isEsqlUnknownIndexError(error)) {
      return undefined;
    }
    throw error;
  }
};

/** The rows of a response as objects keyed by column name. An absent response has no rows. */
export const esqlRows = (response: EsqlQueryResponse | undefined): EsqlRow[] => {
  if (!response) return [];
  const names = response.columns.map((column) => column.name);
  return response.values.map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index]]))
  );
};
