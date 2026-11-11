/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import { WrappedElasticsearchClientError } from '@kbn/observability-utils-server/es/unwrap_es_response';

/**
 * ES|QL fails with 400 `verification_exception` ("Unknown index") where the Query DSL returned
 * no hits for an index pattern that matches nothing. Same check as `isEsqlUnknownIndexError`
 * in `@kbn/storage-adapter`, which this plugin does not depend on.
 *
 * Accepts the error as thrown by `unwrapEsResponse`, which wraps the client error.
 */
export const isEsqlUnknownIndexError = (thrown: unknown): boolean => {
  const error = thrown instanceof WrappedElasticsearchClientError ? thrown.originalError : thrown;
  if (!(error instanceof errors.ResponseError) || error.statusCode !== 400) return false;
  const body = error.body as { error?: { type?: string; reason?: string } } | undefined;
  return (
    body?.error?.type === 'verification_exception' &&
    typeof body.error.reason === 'string' &&
    body.error.reason.includes('Unknown index')
  );
};
