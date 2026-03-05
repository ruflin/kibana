/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { NonEmptyString } from '@kbn/zod-helpers';
import type { Condition } from '@kbn/streamlang';
import { conditionSchema } from '@kbn/streamlang';
import { primitive } from '../shared/record_types';
import type { SignificantEventsResponse } from '../api/significant_events';

/**
 * The purpose of a sig events query — describes *why* the query exists.
 *
 * - `detection`  (default) Detects specific significant events (errors, failures, anomalies).
 * - `exclusion`  Identifies known-noisy or low-signal patterns to filter out (noise canceling).
 * - `stats`      Aggregation-based metrics: error rates, throughput, latency percentiles, etc.
 * - `baseline`   Captures normal operating ranges as a reference for anomaly detection.
 * - `correlation` Cross-field or cross-stream correlation to surface co-occurring patterns.
 */
export type StreamQueryPurpose = 'detection' | 'exclusion' | 'stats' | 'baseline' | 'correlation';

interface StreamQueryBase {
  id: string;
  title: string;
  query_type?: 'row' | 'stats';
  /**
   * The purpose of this query. Defaults to `detection`.
   * Use `exclusion` for noise-canceling queries, `stats` for aggregation metrics,
   * `baseline` for normal-range references, and `correlation` for co-occurrence analysis.
   */
  query_purpose?: StreamQueryPurpose;
}

export interface StreamQuery extends StreamQueryBase {
  /**
   * @deprecated Use esql.query instead. Will be removed in a future version.
   */
  feature?: {
    name: string;
    filter: Condition;
    type: 'system';
  };
  /**
   * @deprecated Use esql.query instead. Will be removed in a future version.
   */
  kql: {
    query: string;
  };
  /**
   * Full ES|QL query built from the stream indices, KQL query, and feature filter.
   * Example: FROM stream,stream.* | WHERE KQL("message: error")
   *
   * For stats queries (query_type: 'stats'), this is the raw ES|QL aggregation query
   * provided directly rather than derived from KQL.
   * Example: FROM stream | STATS error_rate = COUNT_IF(http.response.status_code >= 500) / COUNT(*) BY BUCKET(@timestamp, 5m)
   */
  esql: {
    query: string;
  };
  // from 0 to 100. aligned with anomaly detection scoring
  severity_score?: number;
  evidence?: string[];
}

const streamQueryBaseSchema: z.Schema<StreamQueryBase> = z.object({
  id: NonEmptyString,
  title: NonEmptyString,
  query_type: z
    .enum(['row', 'stats'])
    .optional()
    .describe('Type of ES|QL query: row (default) or stats (aggregation)'),
  query_purpose: z
    .enum(['detection', 'exclusion', 'stats', 'baseline', 'correlation'])
    .optional()
    .describe(
      'Purpose of the query: detection (default), exclusion (noise-canceling), stats (aggregation metrics), baseline (normal-range reference), correlation (co-occurrence analysis)'
    ),
});

export type StreamQueryInput = Omit<StreamQuery, 'esql'> & {
  /**
   * Raw ES|QL query override. When provided, this is used as-is instead of deriving
   * the query from `kql` + `feature`. Required for `query_type: 'stats'` queries.
   *
   * Example: `FROM stream | STATS error_rate = COUNT_IF(http.response.status_code >= 500) / COUNT(*) BY BUCKET(@timestamp, 5m)`
   */
  esql_override?: string;
};

export const streamQueryInputSchema: z.Schema<StreamQueryInput> = z.intersection(
  streamQueryBaseSchema,
  z.object({
    feature: z
      .object({
        name: NonEmptyString,
        filter: conditionSchema,
        type: z.literal('system'),
      })
      .optional(),
    kql: z.object({
      query: z.string(),
    }),
    severity_score: z.number().optional(),
    evidence: z.array(z.string()).optional(),
    esql_override: z
      .string()
      .optional()
      .describe(
        'Raw ES|QL query override. Used as-is instead of deriving from KQL. Required for stats queries.'
      ),
  })
);

export const streamQuerySchema: z.Schema<StreamQuery> = z.intersection(
  streamQueryInputSchema,
  z.object({
    esql: z.object({
      query: z.string().describe('Full ES|QL query.'),
    }),
  })
);

export const querySchema: z.ZodType<QueryDslQueryContainer> = z.lazy(() =>
  z.record(z.union([primitive, z.array(z.union([primitive, querySchema])), querySchema]))
);

export const upsertStreamQueryRequestSchema = z.object({
  title: NonEmptyString,
  feature: z
    .object({
      name: NonEmptyString,
      filter: conditionSchema,
      type: z.literal('system'),
    })
    .optional(),
  kql: z.object({
    query: z.string(),
  }),
  severity_score: z.number().optional(),
  evidence: z.array(z.string()).optional(),
  query_purpose: z
    .enum(['detection', 'exclusion', 'stats', 'baseline', 'correlation'])
    .optional()
    .describe(
      'Purpose of the query: detection (default), exclusion (noise-canceling), stats (aggregation metrics), baseline (normal-range reference), correlation (co-occurrence analysis)'
    ),
});

export interface QueriesGetResponse {
  queries: SignificantEventsResponse[];
  page: number;
  perPage: number;
  total: number;
}

export interface QueriesOccurrencesGetResponse {
  occurrences_histogram: Array<{ x: string; y: number }>;
  total_occurrences: number;
}
