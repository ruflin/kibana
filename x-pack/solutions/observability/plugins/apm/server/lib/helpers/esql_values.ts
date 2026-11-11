/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql, type ComposerQuery } from '@elastic/esql';
import type { ESQLSearchResponse } from '@kbn/es-types';
import { esqlRows } from './esql_read';

/** ES|QL returns dates as ISO strings; the Query DSL aggregations returned epoch milliseconds. */
export function toEpochMillis(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

/**
 * The rows as the Query DSL `fields` option returns them: every non-null column wrapped in an
 * array.
 */
export function esqlRowsAsFields(
  response: ESQLSearchResponse | undefined
): Array<Record<string, unknown[]>> {
  return esqlRows(response).map((row) =>
    Object.fromEntries(
      Object.entries(row)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([name, value]) => [name, Array.isArray(value) ? value : [value]])
    )
  );
}

/** The first row as `fields`, or `undefined` when the response has no row. */
export function esqlRowAsFields(
  response: ESQLSearchResponse | undefined
): Record<string, unknown[]> | undefined {
  return esqlRowsAsFields(response)[0];
}

/**
 * Adds a `bucket` column holding the start of the fixed-interval bucket (epoch milliseconds) of
 * `@timestamp`. Buckets align to the epoch, like a Query DSL `date_histogram` `fixed_interval`.
 */
export function addTimeBucket(query: ComposerQuery, intervalMs: number): ComposerQuery {
  return query.pipe`EVAL bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ${{ intervalMs }}`;
}

/**
 * The bucket starts a `date_histogram` with `min_doc_count: 0` and `extended_bounds` would return:
 * every epoch-aligned bucket from the one holding `start` to the one holding `end`.
 */
export function getTimeBucketKeys({
  start,
  end,
  intervalMs,
}: {
  start: number;
  end: number;
  intervalMs: number;
}): number[] {
  const keys: number[] = [];
  if (!(intervalMs > 0)) {
    return keys;
  }
  for (let key = Math.floor(start / intervalMs) * intervalMs; key <= end; key += intervalMs) {
    keys.push(key);
  }
  return keys;
}

/** The rows of a bucketed (`... BY bucket`) response, keyed by the bucket start. */
export function esqlBucketMap(
  response: ESQLSearchResponse | undefined
): Map<number, Record<string, unknown>> {
  return new Map(esqlRows(response).map((row) => [Number(row.bucket), row]));
}

/** A numeric column as a number, or `null` for a missing or null value. */
export function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** `WHERE field == value` with the value as a named parameter; no clause for a null value. */
export function whereTerm(
  query: ComposerQuery,
  field: string,
  value: string | number | boolean | null | undefined
): ComposerQuery {
  if (value === null || value === undefined) {
    return query;
  }
  return query.pipe`WHERE ${esql.col(field)} == ${{
    [`${field.replace(/\W/g, '_')}_value`]: value,
  }}`;
}

/** The most groups read for a terms-like `STATS ... BY`, so the rest can be counted as "other". */
export const MAX_ESQL_TERMS = 10_000;

export interface TermsBuckets {
  buckets: Array<{ key: string | number; doc_count: number }>;
  sum_other_doc_count: number;
}

/**
 * The top `size` groups of a `STATS doc_count = COUNT(*) BY field` response (most frequent first)
 * and the number of documents in the remaining groups, like a `terms` aggregation returns them.
 */
export function esqlTermsBuckets(
  response: ESQLSearchResponse | undefined,
  field: string,
  size: number
): TermsBuckets {
  const groups = esqlRows(response).map((row) => ({
    key: row[field] as string | number,
    doc_count: Number(row.doc_count),
  }));
  return {
    buckets: groups.slice(0, size),
    sum_other_doc_count: groups.slice(size).reduce((sum, group) => sum + group.doc_count, 0),
  };
}

/** `WHERE field IS NOT NULL | STATS doc_count = COUNT(*) BY field | SORT ... | LIMIT`. */
export function topTermsQuery(
  query: ComposerQuery,
  field: string,
  limit: number = MAX_ESQL_TERMS
): ComposerQuery {
  return query.pipe`WHERE ${esql.col(field)} IS NOT NULL`
    .pipe`STATS doc_count = COUNT(*) BY ${esql.col(field)}`.pipe`SORT doc_count DESC, ${esql.col(
    field
  )} ASC`.limit(limit);
}

/** The most groups a `terms` aggregation over error groups returned in the sparkline requests. */
const MAX_SPARKLINE_GROUPS = 500;

/** `WHERE field IN (values)`; no clause for an empty list, like `termsQuery`. */
export function whereIn(query: ComposerQuery, field: string, values: string[]): ComposerQuery {
  if (values.length === 0) {
    return query;
  }
  return query.pipe`WHERE ${esql.col(field)} IN (${{
    [`${field.replace(/\W/g, '_')}_values`]: values,
  }})`;
}

/**
 * Counts the documents per group and time bucket: `STATS doc_count = COUNT(*) BY field, bucket`.
 * Expects the `bucket` column of {@link addTimeBucket}.
 */
export function countByGroupAndBucket(
  query: ComposerQuery,
  field: string,
  { groupIds, bucketCount }: { groupIds: string[]; bucketCount: number }
): ComposerQuery {
  const groupCount =
    groupIds.length > 0 ? Math.min(groupIds.length, MAX_SPARKLINE_GROUPS) : MAX_SPARKLINE_GROUPS;
  return query.pipe`STATS doc_count = COUNT(*) BY ${esql.col(field)}, bucket`.limit(
    Math.min(groupCount * Math.max(bucketCount, 1), MAX_ESQL_TERMS)
  );
}

/**
 * The per-group time series of a {@link countByGroupAndBucket} response: the groups with the most
 * documents first, each with a point for every bucket of the range.
 */
export function esqlGroupedSeries(
  response: ESQLSearchResponse | undefined,
  field: string,
  bucketKeys: number[]
): Array<{ group: string; timeseries: Array<{ x: number; y: number }> }> {
  const groups = new Map<string, { total: number; counts: Map<number, number> }>();
  for (const row of esqlRows(response)) {
    const group = String(row[field]);
    const entry = groups.get(group) ?? { total: 0, counts: new Map<number, number>() };
    entry.counts.set(Number(row.bucket), Number(row.doc_count));
    entry.total += Number(row.doc_count);
    groups.set(group, entry);
  }
  return [...groups.entries()]
    .sort(([groupA, a], [groupB, b]) => b.total - a.total || groupA.localeCompare(groupB))
    .slice(0, MAX_SPARKLINE_GROUPS)
    .map(([group, { counts }]) => ({
      group,
      timeseries: bucketKeys.map((key) => ({ x: key, y: counts.get(key) ?? 0 })),
    }));
}
