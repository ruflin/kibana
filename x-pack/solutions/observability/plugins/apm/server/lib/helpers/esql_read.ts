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

/**
 * ES|QL fails with 400 `verification_exception` ("Unknown index") where the Query DSL returned
 * no hits for an index pattern that matches nothing. Same check as `isEsqlUnknownIndexError`
 * in `@kbn/storage-adapter`, which this plugin does not depend on.
 */
export function isEsqlUnknownIndexError(error: unknown): boolean {
  if (!(error instanceof errors.ResponseError) || error.statusCode !== 400) return false;
  const body = error.body as { error?: { type?: string; reason?: string } } | undefined;
  return (
    body?.error?.type === 'verification_exception' &&
    typeof body.error.reason === 'string' &&
    body.error.reason.includes('Unknown index')
  );
}

/**
 * Runs a composed ES|QL query. Clauses that cannot be written as a plain `WHERE` on a scalar
 * field (KQL, environment, multi-valued keywords, ranges) are passed as a Query DSL `filter`.
 * Returns `undefined` when no index matches, so callers return their empty result.
 */
export async function runEsqlRead({
  esClient,
  query,
  filter,
  signal,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
  signal?: AbortSignal;
}): Promise<ESQLSearchResponse | undefined> {
  const { filter: _composerFilter, ...request } = query.toRequest();
  try {
    const body: EsqlQueryRequest = {
      ...(request as unknown as EsqlQueryRequest),
      ...(filter ? { filter } : {}),
    };
    return (await (signal
      ? esClient.esql.query(body, { signal })
      : esClient.esql.query(body))) as unknown as ESQLSearchResponse;
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) {
      return undefined;
    }
    throw error;
  }
}

/** The rows of a response as objects keyed by column name. An absent response has no rows. */
export function esqlRows(response: ESQLSearchResponse | undefined): Array<Record<string, unknown>> {
  if (!response) return [];
  const names = response.columns.map((column) => column.name);
  return response.values.map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index]]))
  );
}
