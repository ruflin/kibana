/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import type { ComposerQuery } from '@elastic/esql';
import type { ESQLSearchResponse } from '@kbn/es-types';

/**
 * ES|QL fails with 400 `verification_exception` ("Unknown index") where the Query DSL (with
 * `ignore_unavailable`) returned no hits for an index pattern that matches nothing. Same check as
 * `isEsqlUnknownIndexError` in `@kbn/storage-adapter`, which this plugin does not depend on.
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

/** The composer request without its own `filter`; callers pass the Query DSL filter explicitly. */
export const toEsqlRequest = (query: ComposerQuery): EsqlQueryRequest => {
  const { filter: _composerFilter, ...rest } = query.toRequest();
  return rest as unknown as EsqlQueryRequest;
};

export const EMPTY_ESQL_RESPONSE: ESQLSearchResponse = { columns: [], values: [] };

/** The rows of a response as objects keyed by column name. */
export const esqlRows = (
  response: ESQLSearchResponse | undefined
): Array<Record<string, unknown>> => {
  if (!response) return [];
  const names = response.columns.map((column) => column.name);
  return response.values.map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index]]))
  );
};
