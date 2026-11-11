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
import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';

// Index names the ES|QL parser reads without quotes. Anything else is quoted, so that an index
// name can never end the `FROM` command.
const UNQUOTED_SOURCE = /^[A-Za-z0-9._*:-]+$/;

export const toEsqlSource = (source: string): string =>
  UNQUOTED_SOURCE.test(source) ? source : `"${source.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * ES|QL reports a missing index as a 400 `verification_exception` ("Unknown index [<name>]"),
 * where the search and count APIs answer with a 404 `index_not_found_exception`.
 */
export const isEsqlUnknownIndexException = (error: unknown): boolean => {
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

/** Runs a composed query. Named parameters go in the request; `filter` carries Query DSL. */
export const runEsql = async (
  client: ElasticsearchClient,
  query: ComposerQuery,
  filter?: QueryDslQueryContainer
): Promise<{ columns: Array<{ name: string; type: string }>; values: unknown[][] }> => {
  const { query: text, params } = query.toRequest();
  return (await client.esql.query({
    query: text,
    ...(params && params.length > 0 ? { params } : {}),
    ...(filter ? { filter } : {}),
  } as unknown as EsqlQueryRequest)) as unknown as {
    columns: Array<{ name: string; type: string }>;
    values: unknown[][];
  };
};

/** The number of documents of an index that match the optional Query DSL `filter`. */
export const esqlCount = async (
  client: ElasticsearchClient,
  index: string,
  filter?: QueryDslQueryContainer
): Promise<number> => {
  const response = await runEsql(
    client,
    esql.from([toEsqlSource(index)]).pipe`STATS total = COUNT(*)`,
    filter
  );
  const total = response.values[0]?.[0];
  return typeof total === 'number' ? total : 0;
};
