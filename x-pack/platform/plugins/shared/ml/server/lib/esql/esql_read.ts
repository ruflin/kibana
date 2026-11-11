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

/** One row of an ES|QL response, keyed by column name. */
export type EsqlRow = Record<string, unknown>;

/**
 * ES|QL reports a missing index as a 400 `verification_exception` ("Unknown index [<name>]"),
 * where the Query DSL searches that used `ignore_unavailable` returned no hits.
 */
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
 * Runs a composed ES|QL query. The composer's named params travel in the request body. A Query DSL
 * `filter` (and `project_routing`) is added to the request body when given.
 * With `emptyOnUnknownIndex`, a missing index yields `undefined` instead of an error.
 */
export const runEsql = async ({
  esClient,
  query,
  filter,
  projectRouting,
  emptyOnUnknownIndex = false,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
  projectRouting?: string;
  emptyOnUnknownIndex?: boolean;
}): Promise<ESQLSearchResponse | undefined> => {
  const { filter: _composerFilter, ...request } = query.toRequest();
  try {
    return (await esClient.esql.query({
      ...request,
      ...(filter ? { filter } : {}),
      ...(projectRouting ? { project_routing: projectRouting } : {}),
    } as unknown as EsqlQueryRequest)) as unknown as ESQLSearchResponse;
  } catch (error) {
    if (emptyOnUnknownIndex && isEsqlUnknownIndexError(error)) return undefined;
    throw error;
  }
};

/** The rows of a response as objects keyed by column name. */
export const esqlRows = (response: ESQLSearchResponse | undefined): EsqlRow[] => {
  if (!response) return [];
  const names = response.columns.map((column) => column.name);
  return response.values.map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index]]))
  );
};

/** Wraps a single value or an array in an array; `null` and `undefined` become `[]`. */
export const toArray = <T>(value: T | T[] | null | undefined): T[] =>
  value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
