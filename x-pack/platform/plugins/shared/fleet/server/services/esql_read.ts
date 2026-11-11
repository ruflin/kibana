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

/*
 * Shared plumbing for the Fleet reads that moved from the Query DSL to ES|QL.
 *
 * - A missing index is a 400 `verification_exception` ("Unknown index") in ES|QL, where the DSL
 *   searches used `ignore_unavailable` or `ignore: [404]`. Callers that tolerated a missing index
 *   pass `ignoreUnknownIndex` and get `undefined` back.
 * - The composer's named parameters go in the request body. A clause that cannot be a plain
 *   `WHERE` (multi-valued fields, KQL translated to Query DSL) goes in the request `filter`.
 */

/** One row of an ES|QL response, keyed by column name. */
export type EsqlRow = Record<string, unknown>;

/** ES|QL reports a missing concrete index as a 400 `verification_exception`, not a 404. */
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

const toEsqlRequest = (query: ComposerQuery): EsqlQueryRequest => {
  const { filter: _composerFilter, ...rest } = query.toRequest();
  return rest as unknown as EsqlQueryRequest;
};

export const runEsqlRead = async ({
  esClient,
  query,
  filter,
  ignoreUnknownIndex = false,
  signal,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
  /** Resolve `undefined` for a missing index, as the DSL `ignore_unavailable` did. */
  ignoreUnknownIndex?: boolean;
  signal?: AbortSignal;
}): Promise<ESQLSearchResponse | undefined> => {
  try {
    const request = {
      ...toEsqlRequest(query),
      ...(filter ? { filter } : {}),
    };
    return (await (signal
      ? esClient.esql.query(request, { signal })
      : esClient.esql.query(request))) as unknown as ESQLSearchResponse;
  } catch (error) {
    if (ignoreUnknownIndex && isEsqlUnknownIndexError(error)) {
      return undefined;
    }
    throw error;
  }
};

/** The rows of a response as objects keyed by column name. An absent response has no rows. */
export const esqlRows = (response: ESQLSearchResponse | undefined): EsqlRow[] => {
  if (!response) return [];
  const names = response.columns.map((column) => column.name);
  return response.values.map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index]]))
  );
};

/** The `_source` object of each row, skipping rows without one. */
export const esqlSources = <T>(response: ESQLSearchResponse | undefined): T[] =>
  esqlRows(response).flatMap((row) =>
    row._source !== null && typeof row._source === 'object' ? [row._source as T] : []
  );

/**
 * ES|QL counterpart of `buildPolicyBaseIdsWithFallbackEsFilter`: documents migrated to
 * `policy_base_id` match on it, older ones match on the exact `policy_id`.
 */
export const wherePolicyBaseIdsWithFallback = (
  query: ComposerQuery,
  agentPolicyIds: string[]
): ComposerQuery => {
  const baseIds = Array.from(new Set(agentPolicyIds));
  if (baseIds.length === 0) {
    return query.where`false`;
  }
  return query.where`policy_base_id IN (${{ baseIds }}) OR (policy_id IN (${{
    baseIds,
  }}) AND policy_base_id IS NULL)`;
};
