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

/*
 * Plumbing for the reads that moved from the Query DSL to ES|QL. The access and namespace
 * clauses (`getAccessQuery`, ...) are Query DSL and are sent as the request `filter`, so they
 * keep their DSL semantics.
 */

interface EsqlResponse {
  columns: Array<{ name: string; type: string }>;
  values: unknown[][];
}

export type EsqlRow = Record<string, unknown>;

/** Matches the error ES|QL returns for an unknown index or a pattern without matches. */
export function isEsqlUnknownIndexError(error: unknown): boolean {
  const candidate = error as
    | { statusCode?: number; body?: { error?: { type?: string; reason?: string } } }
    | undefined;
  const reason = candidate?.body?.error?.reason;
  return (
    candidate?.statusCode === 400 &&
    candidate.body?.error?.type === 'verification_exception' &&
    typeof reason === 'string' &&
    reason.includes('Unknown index')
  );
}

/** Runs the query and returns its rows as objects keyed by column name. */
export async function runEsqlRows({
  esClient,
  query,
  filter,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
}): Promise<EsqlRow[]> {
  const { filter: _composerFilter, ...request } = query.toRequest();
  const response = (await esClient.esql.query({
    ...(request as unknown as EsqlQueryRequest),
    ...(filter ? { filter } : {}),
  })) as unknown as EsqlResponse;

  const names = response.columns.map((column) => column.name);
  return response.values.map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index]]))
  );
}
