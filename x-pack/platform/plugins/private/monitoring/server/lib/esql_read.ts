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

/** One row of an ES|QL response, keyed by column name. */
export type EsqlRow = Record<string, unknown>;

/**
 * ES|QL reports a missing index as a 400 `verification_exception` ("Unknown index [<name>]"),
 * where the searches with `ignore_unavailable` or a wildcard pattern returned no hits.
 */
export const isEsqlUnknownIndexError = (error: unknown): boolean => {
  const { statusCode, body } = (error ?? {}) as {
    statusCode?: number;
    body?: { error?: { type?: string; reason?: string } };
  };
  return (
    statusCode === 400 &&
    body?.error?.type === 'verification_exception' &&
    typeof body.error.reason === 'string' &&
    body.error.reason.includes('Unknown index')
  );
};

/**
 * Runs a composed ES|QL query and returns the rows keyed by column name. The Query DSL `filter`
 * holds the monitoring time range, cluster and type clauses. A missing index yields no rows.
 */
export const runEsqlRows = async (
  client: ElasticsearchClient,
  query: ComposerQuery,
  filter?: QueryDslQueryContainer
): Promise<EsqlRow[]> => {
  const { query: esqlQuery, params } = query.toRequest();
  try {
    const response = (await client.esql.query({
      query: esqlQuery,
      ...(params ? { params } : {}),
      ...(filter ? { filter } : {}),
    } as unknown as EsqlQueryRequest)) as unknown as {
      columns: Array<{ name: string }>;
      values: unknown[][];
    };
    const names = response.columns.map((column) => column.name);
    return response.values.map((row) =>
      Object.fromEntries(names.map((name, index) => [name, row[index]]))
    );
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) return [];
    throw error;
  }
};
