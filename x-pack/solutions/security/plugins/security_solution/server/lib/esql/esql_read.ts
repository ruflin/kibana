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
  signal,
  ignoreUnknownIndex = false,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
  signal?: AbortSignal;
  ignoreUnknownIndex?: boolean;
}): Promise<EsqlQueryResponse | undefined> => {
  const { query: text, params } = query.toRequest();
  const request = {
    query: text,
    ...(params?.length ? { params } : {}),
    ...(filter ? { filter } : {}),
  } as EsqlQueryRequest;
  try {
    return await (signal ? esClient.esql.query(request, { signal }) : esClient.esql.query(request));
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
