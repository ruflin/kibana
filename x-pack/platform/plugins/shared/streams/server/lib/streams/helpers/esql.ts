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
import { esql, type ComposerQuery } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { ESQLSearchResponse } from '@kbn/es-types';
import { isEsqlUnknownIndexError } from '@kbn/storage-adapter';

/** Normalises a field name into a Composer column ref, splitting dotted names into the array shorthand. */
export const normalizeColumn = (field: string) =>
  esql.col(field.includes('.') ? field.split('.') : field);

/** Index of `name` in `response.columns`, or `-1` when absent. Structural type so it accepts both `ESQLSearchResponse` and the raw `esClient.esql.query` return. */
export const getColumnIndex = (
  response: { columns: Array<{ name: string }> },
  name: string
): number => response.columns.findIndex((c) => c.name === name);

/** Convenience for the common `_source` lookup; equivalent to `getColumnIndex(response, '_source')`. */
export const getSourceColumnIndex = (response: { columns: Array<{ name: string }> }): number =>
  getColumnIndex(response, '_source');

/** Bridges `ComposerQuery.toRequest()` to `EsqlQueryRequest` — strips the loose `filter` and casts through `unknown` for named params (typed as positional in the ES client). */
export const toEsqlRequest = (query: ComposerQuery): EsqlQueryRequest => {
  const { filter: _composerFilter, ...rest } = query.toRequest();
  return rest as unknown as EsqlQueryRequest;
};

/** Maps each row's `_source` column through `fromStorage`. Returns `[]` if the column is absent. */
export const mapSourceRows = <TStored, TApp>(
  response: ESQLSearchResponse,
  fromStorage: (raw: TStored) => TApp
): TApp[] => {
  const sourceIdx = getSourceColumnIndex(response);
  if (sourceIdx === -1) return [];
  return response.values.map((row) => fromStorage(row[sourceIdx] as TStored));
};

/**
 * Runs a composed query. `filter` is the request-level Query DSL filter, for clauses that cannot be
 * a plain `WHERE` (date math ranges, flattened fields). With `ignoreMissingIndex`, a missing index
 * gives `undefined`, like the DSL `ignore_unavailable` option, instead of a 400 `verification_exception`.
 */
export const runEsqlQuery = async ({
  esClient,
  query,
  filter,
  ignoreMissingIndex = false,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
  ignoreMissingIndex?: boolean;
}): Promise<ESQLSearchResponse | undefined> => {
  try {
    return (await esClient.esql.query({
      ...toEsqlRequest(query),
      ...(filter ? { filter } : {}),
    })) as unknown as ESQLSearchResponse;
  } catch (error) {
    if (ignoreMissingIndex && isEsqlUnknownIndexError(error)) return undefined;
    throw error;
  }
};

/** A sampled document, shaped like the part of a search hit that callers read. */
export interface SampleHit {
  _source: Record<string, unknown>;
}

/** The `_source` of each row as a sample hit, skipping rows without one. */
export const getSampleHits = (response: ESQLSearchResponse | undefined): SampleHit[] => {
  if (!response) return [];
  const sourceIdx = getSourceColumnIndex(response);
  if (sourceIdx === -1) return [];
  return response.values.flatMap((row) => {
    const source = row[sourceIdx];
    return source !== null && typeof source === 'object'
      ? [{ _source: source as Record<string, unknown> }]
      : [];
  });
};

/** The `size` latest documents of `index`, newest first. Equivalent to a DSL search sorted by `@timestamp` desc. */
export const fetchLatestHits = async ({
  esClient,
  index,
  size,
  ignoreMissingIndex = false,
}: {
  esClient: ElasticsearchClient;
  index: string;
  size: number;
  ignoreMissingIndex?: boolean;
}): Promise<SampleHit[]> =>
  getSampleHits(
    await runEsqlQuery({
      esClient,
      query: esql.from([index], ['_source']).pipe`SORT @timestamp DESC NULLS LAST`.limit(size),
      ignoreMissingIndex,
    })
  );

/** The number in `column` of the first row, `0` when the response has no such row or column. */
export const getFirstNumber = (
  response: ESQLSearchResponse | undefined,
  column: string
): number => {
  if (!response) return 0;
  const idx = getColumnIndex(response, column);
  const value = idx === -1 ? 0 : Number(response.values[0]?.[idx] ?? 0);
  return Number.isFinite(value) ? value : 0;
};
