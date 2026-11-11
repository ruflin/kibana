/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type {
  EsqlQueryRequest,
  QueryDslQueryContainer,
} from '@elastic/elasticsearch/lib/api/types';
import type { ComposerQuery } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { ESQLSearchResponse } from '@kbn/es-types';

/** An ES|QL query on an index pattern that matches nothing fails with a 400 `Unknown index`. */
export const isEsqlUnknownIndexError = (error: unknown): boolean => {
  if (!(error instanceof errors.ResponseError) || error.statusCode !== 400) return false;
  const body = error.body as { error?: { type?: string; reason?: string } } | undefined;
  return (
    body?.error?.type === 'verification_exception' &&
    typeof body.error.reason === 'string' &&
    body.error.reason.includes('Unknown index')
  );
};

/**
 * Runs a composed query. `filter` is the request-level Query DSL filter for the clauses that stay
 * Query DSL. A missing index gives `undefined`, like the DSL search the callers used, which
 * returned no hits for an index pattern that matches nothing.
 */
export const runEsqlQuery = async ({
  esClient,
  query,
  filter,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
}): Promise<ESQLSearchResponse | undefined> => {
  const { filter: _composerFilter, ...request } = query.toRequest();
  try {
    return (await esClient.esql.query({
      ...request,
      ...(filter ? { filter } : {}),
    } as unknown as EsqlQueryRequest)) as unknown as ESQLSearchResponse;
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) return undefined;
    throw error;
  }
};

/** The rows of a response as objects keyed by column name. */
export const getRows = (
  response: ESQLSearchResponse | undefined
): Array<Record<string, unknown>> => {
  if (!response) return [];
  const names = response.columns.map(({ name }) => name);
  return response.values.map((row) => Object.fromEntries(names.map((name, i) => [name, row[i]])));
};
