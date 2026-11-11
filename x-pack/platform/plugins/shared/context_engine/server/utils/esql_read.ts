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
import type { ESQLSearchResponse } from '@kbn/es-types';
import { isEsqlUnknownIndexError } from '@kbn/storage-adapter';

/*
 * Plumbing for the reads that moved from the Query DSL to ES|QL. The composer's named parameters
 * go in the request body. A clause that needs Query DSL semantics (date math, `ids`, the
 * default-space `must_not exists` match) goes in the request `filter`, not in `WHERE`.
 */

export type EsqlRow = Record<string, unknown>;

/**
 * Runs the query. An unknown index is an error in ES|QL (400 `verification_exception`), where the
 * DSL reads used `ignore_unavailable`. `ignoreUnknownIndex` returns `undefined` for it, and
 * callers return their empty result.
 */
export async function runEsqlRead({
  esClient,
  query,
  filter,
  ignoreUnknownIndex = false,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
  ignoreUnknownIndex?: boolean;
}): Promise<ESQLSearchResponse | undefined> {
  const { filter: _composerFilter, ...request } = query.toRequest();
  try {
    return (await esClient.esql.query({
      ...(request as unknown as EsqlQueryRequest),
      ...(filter ? { filter } : {}),
    })) as unknown as ESQLSearchResponse;
  } catch (error) {
    if (ignoreUnknownIndex && isEsqlUnknownIndexError(error)) {
      return undefined;
    }
    throw error;
  }
}

/** The rows of a response as objects keyed by column name. An absent response has no rows. */
export function esqlRows(response: Pick<ESQLSearchResponse, 'columns' | 'values'> | undefined) {
  if (!response) return [];
  const names = response.columns.map((column) => column.name);
  return response.values.map(
    (row): EsqlRow => Object.fromEntries(names.map((name, index) => [name, row[index]]))
  );
}
