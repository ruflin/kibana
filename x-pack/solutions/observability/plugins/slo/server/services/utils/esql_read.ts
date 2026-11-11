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

/** Matches the 400 `verification_exception` ES|QL returns for an unknown index or an empty pattern. */
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

/**
 * Runs a composed ES|QL query and returns its rows as objects keyed by column name. The composer's
 * named parameters go in the request body. A clause that cannot be a plain `WHERE` goes in `filter`
 * (Query DSL), which ES|QL applies before the query runs.
 *
 * A pattern that matches no index is an error in ES|QL, where the DSL returns no hits. Set
 * `ignoreUnknownIndex` to get no rows for it.
 */
export async function runEsqlRows({
  esClient,
  query,
  filter,
  projectRouting,
  ignoreUnknownIndex = false,
  signal,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
  projectRouting?: string;
  ignoreUnknownIndex?: boolean;
  signal?: AbortSignal;
}): Promise<EsqlRow[]> {
  const { filter: _composerFilter, ...request } = query.toRequest();
  let response;
  try {
    response = await esClient.esql.query(
      {
        ...(request as unknown as EsqlQueryRequest),
        ...(filter ? { filter } : {}),
        ...(projectRouting ? { project_routing: projectRouting } : {}),
      },
      { signal }
    );
  } catch (error) {
    if (ignoreUnknownIndex && isEsqlUnknownIndexError(error)) {
      return [];
    }
    throw error;
  }
  const names = response.columns.map((column) => column.name);
  return response.values.map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index]]))
  );
}
