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
import { esql } from '@elastic/esql';
import type { ComposerQuery } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { ESQLSearchResponse } from '@kbn/es-types';
import Boom from '@hapi/boom';

/*
 * Plumbing for the reads that moved from the Query DSL to ES|QL.
 *
 * - A missing index (or a pattern that matches nothing) is an error in ES|QL (400
 *   `verification_exception`, `Unknown index`), where the DSL searches returned no hits.
 *   `runEsqlRead` returns `undefined` for it and callers return their empty result.
 * - The caller's Query DSL filters (KQL, time range) are sent as the request `filter`, so they
 *   keep their DSL semantics.
 */

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

// The composer prints a source name into the `FROM` command as it is, so a name must never carry
// `|`, a quote, a space or a newline. A name is a (remote cluster prefixed) index, alias, data stream
// or wildcard pattern: it starts with a letter, digit, `.` or `*` (no leading `_`, `-` or `+`).
const ESQL_SOURCE_NAME = /^[A-Za-z0-9.*][A-Za-z0-9._*:+-]*$/;
const MAX_ESQL_SOURCE_NAME_LENGTH = 255;

/**
 * Splits a comma separated index expression into the sources of an ES|QL `FROM`.
 * Throws a 400 for a name that is not a plain index name or wildcard pattern.
 */
export const toEsqlSources = (index: string | string[]): string[] =>
  (Array.isArray(index) ? index : index.split(','))
    .map((source) => source.trim())
    .filter((source) => source.length > 0)
    .map((source) => {
      if (source.length > MAX_ESQL_SOURCE_NAME_LENGTH || !ESQL_SOURCE_NAME.test(source)) {
        throw Boom.badRequest(`Invalid index name or pattern: ${source.slice(0, 80)}`);
      }
      return source;
    });

export async function runEsqlRead({
  esClient,
  query,
  filter,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
}): Promise<ESQLSearchResponse | undefined> {
  const { filter: _composerFilter, ...request } = query.toRequest();
  try {
    return (await esClient.esql.query({
      ...(request as unknown as EsqlQueryRequest),
      ...(filter ? { filter } : {}),
    })) as unknown as ESQLSearchResponse;
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) {
      return undefined;
    }
    throw error;
  }
}

/** The rows of a response as objects keyed by column name. An absent response has no rows. */
export function esqlRows(response: ESQLSearchResponse | undefined): EsqlRow[] {
  if (!response) return [];
  const names = response.columns.map((column) => column.name);
  return response.values.map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index]]))
  );
}

/** Exact number of documents in `index` matching the Query DSL `filter`; `0` for an unknown index. */
export async function esqlCount({
  esClient,
  index,
  filter,
}: {
  esClient: ElasticsearchClient;
  index: string | string[];
  filter?: QueryDslQueryContainer;
}): Promise<number> {
  const response = await runEsqlRead({
    esClient,
    query: esql.from(toEsqlSources(index)).pipe`STATS total = COUNT(*)`,
    filter,
  });
  const total = esqlRows(response)[0]?.total;
  return typeof total === 'number' ? total : 0;
}
