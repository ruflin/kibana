/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';

// Index names the ES|QL parser reads without quotes. Anything else is quoted, so that an index name
// from a request can never end the `FROM` command.
const UNQUOTED_SOURCE = /^[A-Za-z0-9._*:-]+$/;
const toEsqlSource = (source: string): string =>
  UNQUOTED_SOURCE.test(source) ? source : `"${source.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * ES|QL reports a missing index as a 400 `verification_exception` ("Unknown index [<name>]"),
 * where the count API answers 404 `index_not_found_exception`.
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

/** The number of documents in an index, alias, data stream or comma separated index pattern. */
export const countDocuments = async (client: ElasticsearchClient, index: string) => {
  const sources = index
    .split(',')
    .map((source) => source.trim())
    .filter((source) => source.length > 0)
    .map(toEsqlSource);
  const { query } = esql.from(sources).pipe`STATS total = COUNT(*)`.toRequest();
  const response = (await client.esql.query({ query } as EsqlQueryRequest)) as unknown as {
    values: unknown[][];
  };
  const total = response.values[0]?.[0];
  return typeof total === 'number' ? total : 0;
};
