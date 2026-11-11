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
import { esql, type ComposerQuery } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';

/** The part of an ES|QL response the onboarding probes read. */
export interface EsqlTable {
  columns: Array<{ name: string }>;
  values: unknown[][];
}

/**
 * An ES|QL query on an index pattern that matches nothing fails with a 400 `verification_exception`
 * (`Unknown index`). The DSL searches used `ignore_unavailable` and got no hits.
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
 * Runs a composed query. `filter` is the request-level Query DSL filter for clauses that cannot be
 * a plain `WHERE`. Returns `undefined` when the index does not exist.
 */
export const runEsqlQuery = async ({
  esClient,
  query,
  filter,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
}): Promise<EsqlTable | undefined> => {
  const { filter: _composerFilter, ...request } = query.toRequest();
  try {
    return (await esClient.esql.query({
      ...request,
      ...(filter ? { filter } : {}),
    } as unknown as EsqlQueryRequest)) as unknown as EsqlTable;
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) return undefined;
    throw error;
  }
};

/**
 * Whether any document of `indices` matches. `terms` are equality checks on keyword fields, and
 * `filter` keeps the clauses that stay Query DSL (for example a client-supplied time range).
 * The fields can be unmapped in some or all of the indices, where they are null and match nothing,
 * as in the DSL.
 */
export const hasDocuments = async ({
  esClient,
  indices,
  terms = [],
  filter,
}: {
  esClient: ElasticsearchClient;
  indices: string[];
  terms?: Array<{ field: string; value: string }>;
  filter?: QueryDslQueryContainer;
}): Promise<boolean> => {
  let query = esql.from(indices, ['_id']);
  if (terms.length > 0) {
    query.addSetCommand('unmapped_fields', 'NULLIFY');
  }
  terms.forEach(({ field, value }, index) => {
    query = query.where`${esql.col(field.split('.'))} == ${{ [`term${index}`]: value }}`;
  });

  const response = await runEsqlQuery({ esClient, query: query.keep('_id').limit(1), filter });

  return (response?.values.length ?? 0) > 0;
};
