/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql, type ComposerQuery, type ComposerSortShorthand } from '@elastic/esql';
import type { ESQLAstExpression } from '@elastic/esql/types';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { ESQLSearchResponse } from '@kbn/es-types';
import dateMath from '@kbn/datemath';
import { getSourceColumnIndex, toEsqlRequest } from '../streams/esql';
import type { CommonSearchOptions } from './query_utils';
import { runEsqlQuery } from './run_esql_query';

export const isIndexNotFoundError = (error: unknown): boolean => {
  if (error instanceof Error) {
    return (
      error.message.includes('verification_exception') && error.message.includes('Unknown index')
    );
  }
  return false;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// esClient.esql.query() return type doesn't match ESQLSearchResponse.
// Known typing gap in the ES client — centralized here to avoid scattered assertions.
// Uses `toEsqlRequest` so named-parameter holes (`${{ name: value }}`) are bound
// at the protocol level rather than inlined into the query string.
export const queryEsql = async ({
  esClient,
  query,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
}): Promise<ESQLSearchResponse> =>
  (await esClient.esql.query(toEsqlRequest(query))) as ESQLSearchResponse;

// Converts a columnar ESQLSearchResponse into an array of plain objects keyed by column name.
export const esqlToObjects = <T extends Record<string, unknown>>(
  response: ESQLSearchResponse
): T[] =>
  response.values.map(
    (row) =>
      row.reduce<Record<string, unknown>>((acc, value, i) => {
        const col = response.columns[i];
        if (col) acc[col.name] = value;
        return acc;
      }, {}) as T
  );

const parseSourceResponse = <T>(
  response: ESQLSearchResponse,
  fields: readonly string[] = []
): T[] => {
  const sourceIdx = getSourceColumnIndex(response);
  if (sourceIdx === -1) {
    return [];
  }

  const fieldIndexes = fields.map(
    (field) => [field, response.columns.findIndex((column) => column.name === field)] as const
  );

  return response.values.map((row) => {
    const rawSource = row[sourceIdx];
    if (!isRecord(rawSource)) {
      return {} as T;
    }
    // `kibana.space_ids` is added by IDataStreamClient on write; strip the
    // whole `kibana` object so consumers only see the typed payload.
    const { kibana: _kibana, ...rest } = rawSource;
    return fieldIndexes.reduce<Record<string, unknown>>(
      (result, [field, index]) => (index === -1 ? result : { ...result, [field]: row[index] }),
      rest
    ) as T;
  });
};

export const executeEsqlQuery = async <T>({
  esClient,
  query,
  fields,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  fields?: readonly string[];
}): Promise<T[]> => {
  try {
    return parseSourceResponse<T>(await queryEsql({ esClient, query }), fields);
  } catch (error) {
    if (isIndexNotFoundError(error)) {
      return [];
    }
    throw error;
  }
};

export const executeCountQuery = async ({
  esClient,
  query,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
}): Promise<number> => {
  try {
    const response = await queryEsql({ esClient, query });
    const countIdx = response.columns.findIndex((c) => c.name === 'total');
    if (countIdx === -1 || response.values.length === 0) {
      return 0;
    }
    return (response.values[0][countIdx] as number) ?? 0;
  } catch (error) {
    if (isIndexNotFoundError(error)) {
      return 0;
    }
    throw error;
  }
};

export const andWhere = (
  current: ESQLAstExpression | undefined,
  next: ESQLAstExpression
): ESQLAstExpression => {
  return current ? esql.exp`${current} AND ${next}` : next;
};

/**
 * Resolve a time bound to ISO. Only date-math expressions (`now-7d`, `2026-07-01||/d`) go through
 * `dateMath.parse` — plain ISO/date strings pass through verbatim so Elasticsearch parses them as
 * UTC; routing them through moment would reinterpret date-only values in server-local time.
 */
export const resolveTimeBound = (expr: string, { roundUp = false } = {}): string => {
  if (!expr.includes('now') && !expr.includes('||')) return expr;
  const parsed = dateMath.parse(expr, { roundUp });
  if (parsed === undefined || !parsed.isValid()) {
    throw new Error(`Invalid date-math expression: "${expr}"`);
  }
  return parsed.toISOString();
};

export const applyTimeRange = ({
  query,
  from,
  to,
}: {
  query: ComposerQuery;
  from?: string;
  to?: string;
}): ComposerQuery => {
  let timeRangeQuery = query;
  if (from !== undefined) {
    const fromIso = resolveTimeBound(from);
    timeRangeQuery = timeRangeQuery.where`@timestamp >= TO_DATETIME(${{ fromIso }})`;
  }
  if (to !== undefined) {
    const toIso = resolveTimeBound(to, { roundUp: true });
    timeRangeQuery = timeRangeQuery.where`@timestamp <= TO_DATETIME(${{ toIso }})`;
  }
  return timeRangeQuery;
};

/**
 * Keeps entities whose lifetime overlaps `[from, to]`: created on or before `to`, and either still
 * active or last updated on or after `from`. Must run after `pickLatestPerGroup`, so `@timestamp`
 * is the entity's last update, and requires a `created_at` column holding its first `@timestamp`.
 */
export const applyLifetimeOverlap = ({
  query,
  from,
  to,
  activeWhere,
}: {
  query: ComposerQuery;
  from?: string;
  to?: string;
  activeWhere: ESQLAstExpression;
}): ComposerQuery => {
  let overlapQuery = query;
  if (to !== undefined) {
    const overlapToIso = resolveTimeBound(to, { roundUp: true });
    overlapQuery = overlapQuery.where`created_at <= TO_DATETIME(${{ overlapToIso }})`;
  }
  if (from !== undefined) {
    const overlapFromIso = resolveTimeBound(from);
    overlapQuery = overlapQuery.where`${activeWhere} OR @timestamp >= TO_DATETIME(${{
      overlapFromIso,
    }})`;
  }
  return overlapQuery;
};

export type LatestSourceGroupBy = string | [string, string] | [string, string, string];

export type LatestSourceWhereCondition = ESQLAstExpression;

/**
 * Start an ES|QL query from a data stream, filtered to the given space.
 */
export const latestSourceFrom = (index: string, space: string): ComposerQuery =>
  esql.from([index], ['_id', '_source']).where`\`kibana.space_ids\` == ${space}`;

export const withTimeRange = (
  query: ComposerQuery,
  options: CommonSearchOptions
): ComposerQuery => {
  let next = query;
  if (options.from !== undefined) {
    next = next.where`@timestamp >= TO_DATETIME(${esql.str(options.from)})`;
  }
  if (options.to !== undefined) {
    next = next.where`@timestamp <= TO_DATETIME(${esql.str(options.to)})`;
  }
  return next;
};

export const withWhere = (
  query: ComposerQuery,
  condition?: LatestSourceWhereCondition
): ComposerQuery => {
  if (!condition) {
    return query;
  }
  return query.where`${condition}`;
};

const buildGroupByCols = (groupBy: LatestSourceGroupBy) => {
  if (typeof groupBy === 'string') {
    return [esql.col(groupBy)];
  }
  return groupBy.map((field) => esql.col(field));
};

/**
 * Two-stage `INLINE STATS` reduction: keeps the latest revision per group by
 * `MAX(@timestamp)`, breaking ties with `MAX(_id)`.
 */
export const pickLatestPerGroup = (
  query: ComposerQuery,
  groupBy: LatestSourceGroupBy
): ComposerQuery => {
  const groupByCols = buildGroupByCols(groupBy);
  return query.pipe`INLINE STATS latest_ts = MAX(@timestamp) BY ${groupByCols}`
    .where`@timestamp == latest_ts`.pipe`INLINE STATS tiebreaker_id = MAX(_id) BY ${groupByCols}`
    .where`_id == tiebreaker_id`;
};

export const withSort = (query: ComposerQuery, sort?: ComposerSortShorthand[]): ComposerQuery => {
  if (!sort?.length) {
    return query;
  }
  return query.sort(sort[0], ...sort.slice(1));
};

/**
 * Run the composed query, locate `_source`, and strip the `kibana` envelope
 * that `IDataStreamClient` adds on write.
 */
export const executeAndDecodeSource = async <T>(
  esClient: ElasticsearchClient,
  query: ComposerQuery
): Promise<{ hits: T[] }> => {
  const response = await runEsqlQuery(esClient, query.print('basic'));
  if (!response) {
    return { hits: [] };
  }

  const sourceIdx = response.columns.findIndex((c) => c.name === '_source');
  if (sourceIdx === -1) {
    return { hits: [] };
  }

  return {
    hits: response.values.map((row) => {
      const source = (row[sourceIdx] ?? {}) as Record<string, unknown>;
      const { kibana: _kibana, ...rest } = source;
      return rest as T;
    }),
  };
};
