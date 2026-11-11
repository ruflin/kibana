/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql, type ComposerQuery } from '@elastic/esql';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import type { ESQLSearchResponse } from '@kbn/es-types';
import type { FlattenedApmEvent } from '@kbn/apm-data-access-plugin/server/utils/utility_types';
import type { APMEventClient } from './create_es_client/create_apm_event_client';
import { esqlRows } from './esql_read';
import { esqlRowsAsFields } from './esql_values';

type EsqlRequest = Parameters<APMEventClient['esql']>[1];
type EsqlApm = EsqlRequest['apm'];

/**
 * `FROM` over the resolved APM indices. Fields that are not mapped in any matching index read
 * as null, as they did in the Query DSL (where a `term` or `exists` on them just matched nothing).
 */
export const fromApmIndex = (index: string[], metadata?: string[]) =>
  esql.from(index, metadata).addSetCommand('unmapped_fields', 'nullify');

/** A named query parameter for a field, e.g. `service_name` for `service.name`. */
const toParamName = (field: string) => field.replace(/[^a-zA-Z0-9]+/g, '_');

/** `KEEP` of dotted field names, each one nested column path rather than one escaped name. */
export const keepFields = (query: ComposerQuery, [first, ...rest]: [string, ...string[]]) =>
  query.keep(
    first.startsWith('_') ? first : first.split('.'),
    ...rest.map((field) => (field.startsWith('_') ? field : field.split('.')))
  );

/** The request `filter` for Query DSL clauses that cannot be a plain `WHERE` (KQL, environment, ranges). */
export function boolFilter(...clauses: QueryDslQueryContainer[]): QueryDslQueryContainer {
  return { bool: { filter: clauses } };
}

/**
 * Whether at least one document matches, like a `size: 1` / `terminate_after: 1` search. With
 * `anyOfFields`, a document only matches when one of those fields is set.
 */
export async function hasEsqlDocuments({
  apmEventClient,
  operationName,
  apm,
  filter,
  equals,
  anyOfFields,
  skipProcessorEventFilter,
}: {
  apmEventClient: APMEventClient;
  operationName: string;
  apm: EsqlApm;
  filter?: QueryDslQueryContainer;
  /** Scalar fields that must equal a value, as `[field, value]` pairs. */
  equals?: Array<[field: string, value: string]>;
  anyOfFields?: string[];
  skipProcessorEventFilter?: boolean;
}): Promise<boolean> {
  const response = await apmEventClient.esql(operationName, {
    apm,
    query: (index) => {
      let query = fromApmIndex(index);
      for (const [field, value] of equals ?? []) {
        query = query.pipe`WHERE ${esql.col(field)} == ${{ [toParamName(field)]: value }}`;
      }
      const anyFieldSet = anyOfFields
        ?.map((field) => esql.exp`${esql.col(field)} IS NOT NULL`)
        .reduce((left, right) => esql.exp`${left} OR ${right}`);

      return (anyFieldSet ? query.pipe`WHERE ${anyFieldSet}` : query).pipe`KEEP @timestamp`.limit(
        1
      );
    },
    filter,
    skipProcessorEventFilter,
  });

  return (response?.values.length ?? 0) > 0;
}

/**
 * The distinct non-null values of a field, most frequent first (ties by value), like a `terms`
 * aggregation of the given size.
 */
export async function getTopValues({
  apmEventClient,
  operationName,
  apm,
  field,
  size,
  filter,
  where,
  skipProcessorEventFilter,
}: {
  apmEventClient: APMEventClient;
  operationName: string;
  apm: EsqlApm;
  field: string;
  size: number;
  filter?: QueryDslQueryContainer;
  /** Scalar fields that must equal a value, as `[field, value]` pairs. */
  where?: Array<[field: string, value: string]>;
  skipProcessorEventFilter?: boolean;
}): Promise<string[]> {
  const response = await apmEventClient.esql(operationName, {
    apm,
    query: (index) => {
      let query = fromApmIndex(index).pipe`WHERE ${esql.col(field)} IS NOT NULL`;
      for (const [whereField, value] of where ?? []) {
        query = query.pipe`WHERE ${esql.col(whereField)} == ${{
          [toParamName(whereField)]: value,
        }}`;
      }
      return query.pipe`STATS doc_count = COUNT(*) BY ${esql.col(field)}`
        .pipe`SORT doc_count DESC, ${esql.col(field)} ASC`.limit(size);
    },
    filter,
    skipProcessorEventFilter,
  });

  return esqlRows(response).map((row) => String(row[field]));
}

/**
 * The keys of a `date_histogram` with a fixed interval and `extended_bounds`: every multiple of
 * the interval from the bucket holding `start` to the bucket holding `end`.
 */
export function getHistogramKeys({
  start,
  end,
  intervalInMs,
}: {
  start: number;
  end: number;
  intervalInMs: number;
}): number[] {
  if (!(intervalInMs > 0)) {
    return [];
  }
  const first = Math.floor(start / intervalInMs) * intervalInMs;
  const last = Math.floor(end / intervalInMs) * intervalInMs;
  const keys: number[] = [];
  for (let key = first; key <= last; key += intervalInMs) {
    keys.push(key);
  }
  return keys;
}

/**
 * The rows of a response as search hits: the `_id` and `_index` columns become hit properties and
 * every other non-null column becomes a `fields` entry wrapped in an array, as the Query DSL
 * `fields` option returns them.
 */
export function esqlRowsAsHits(response: ESQLSearchResponse | undefined): Array<{
  _id?: string;
  _index?: string;
  fields: Partial<FlattenedApmEvent>;
}> {
  return esqlRows(response).map(({ _id, _index, ...columns }) => ({
    ...(typeof _id === 'string' ? { _id } : {}),
    ...(typeof _index === 'string' ? { _index } : {}),
    fields: Object.fromEntries(
      Object.entries(columns)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([name, value]) => [name, Array.isArray(value) ? value : [value]])
    ) as Partial<FlattenedApmEvent>,
  }));
}

/**
 * The first row as APM event `fields` (every non-null column wrapped in an array), or `undefined`
 * when the response has no row. The columns are the APM field names the query kept.
 */
export function esqlRowAsApmFields(
  response: ESQLSearchResponse | undefined
): Partial<FlattenedApmEvent> | undefined {
  return esqlRowsAsApmFields(response)[0];
}

/** The rows as APM event `fields`, like {@link esqlRowAsApmFields}. */
export function esqlRowsAsApmFields(
  response: ESQLSearchResponse | undefined
): Array<Partial<FlattenedApmEvent>> {
  return esqlRowsAsFields(response);
}
