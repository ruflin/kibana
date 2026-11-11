/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import type { ComposerQuery } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';

/**
 * ES|QL reports a missing index as a 400 `verification_exception` ("Unknown index [<name>]"),
 * where a Query DSL search with `ignore_unavailable` returns no hits.
 *
 * Local equivalent of `isEsqlUnknownIndexError` from `@kbn/storage-adapter`, which this package
 * does not depend on.
 */
export const isEsqlUnknownIndexError = (error: unknown): boolean => {
  if (error == null || typeof error !== 'object') return false;
  const { statusCode, body } = error as {
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

/** The part of an ES|QL response the readers in this package use. */
export interface EsqlReadResponse {
  columns: Array<{ name: string }>;
  values: unknown[][];
}

/**
 * Runs a composed ES|QL read. Returns `undefined` when the index does not exist, which callers
 * treat as no rows (the Query DSL searches they replace used `ignore_unavailable`).
 */
export const runEsqlRead = async ({
  esClient,
  query,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
}): Promise<EsqlReadResponse | undefined> => {
  const { query: text, params } = query.toRequest();
  try {
    return (await esClient.esql.query({
      query: text,
      ...(params ? { params } : {}),
    } as unknown as EsqlQueryRequest)) as unknown as EsqlReadResponse;
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) return undefined;
    throw error;
  }
};
