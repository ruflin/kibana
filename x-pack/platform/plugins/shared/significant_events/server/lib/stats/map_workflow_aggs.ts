/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  SignificantEventsStatsDailyBucket,
  SignificantEventsStatsTokenTotals,
  SignificantEventsStatsWorkflowTypeRow,
} from '../../../common/stats';
import { emptyTokenTotals } from './empty_stats';

interface TermsBucket {
  key: string | number;
  doc_count: number;
  by_status?: { buckets?: Array<{ key: string | number; doc_count: number }> };
  input_tokens?: { value?: number | null };
  output_tokens?: { value?: number | null };
  cached_tokens?: { value?: number | null };
}

interface DateHistogramBucket {
  key_as_string?: string;
  key: number;
  doc_count: number;
  by_workflow?: { buckets?: TermsBucket[] };
  by_status?: { buckets?: Array<{ key: string | number; doc_count: number }> };
  input_tokens?: { value?: number | null };
  output_tokens?: { value?: number | null };
  cached_tokens?: { value?: number | null };
}

export interface WorkflowAggResponse {
  aggregations?: {
    by_day?: { buckets?: DateHistogramBucket[] };
    by_workflow?: { buckets?: TermsBucket[] };
    by_status?: { buckets?: Array<{ key: string | number; doc_count: number }> };
    input_tokens?: { value?: number | null };
    output_tokens?: { value?: number | null };
    cached_tokens?: { value?: number | null };
  };
}

const sumTokens = (bucket: {
  input_tokens?: { value?: number | null };
  output_tokens?: { value?: number | null };
  cached_tokens?: { value?: number | null };
}): SignificantEventsStatsTokenTotals => {
  const input = bucket.input_tokens?.value ?? 0;
  const output = bucket.output_tokens?.value ?? 0;
  const cached = bucket.cached_tokens?.value ?? 0;
  return {
    input,
    output,
    cached,
    total: input + output,
  };
};

const statusMap = (
  buckets: Array<{ key: string | number; doc_count: number }> | undefined
): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const bucket of buckets ?? []) {
    result[String(bucket.key)] = bucket.doc_count;
  }
  return result;
};

export interface MappedWorkflowStats {
  available: boolean;
  totals: {
    workflowRuns: number;
    workflowRunsByStatus: Record<string, number>;
    tokens: SignificantEventsStatsTokenTotals;
  };
  daily: Array<SignificantEventsStatsDailyBucket['workflowRuns'] & { date: string }>;
  workflowTypes: SignificantEventsStatsWorkflowTypeRow[];
}

export const mapWorkflowAggs = ({
  response,
  available,
}: {
  response: WorkflowAggResponse | undefined;
  available: boolean;
}): MappedWorkflowStats => {
  if (!available || !response?.aggregations) {
    return {
      available,
      totals: {
        workflowRuns: 0,
        workflowRunsByStatus: {},
        tokens: emptyTokenTotals(),
      },
      daily: [],
      workflowTypes: [],
    };
  }

  const { aggregations } = response;
  const dayBuckets = aggregations.by_day?.buckets ?? [];
  let workflowRuns = 0;
  const daily = dayBuckets.map((day) => {
    workflowRuns += day.doc_count;
    const byType: Record<string, number> = {};
    for (const workflow of day.by_workflow?.buckets ?? []) {
      byType[String(workflow.key)] = workflow.doc_count;
    }
    return {
      date: day.key_as_string ?? new Date(day.key).toISOString(),
      total: day.doc_count,
      byType,
      byStatus: statusMap(day.by_status?.buckets),
      tokens: sumTokens(day),
    };
  });

  const workflowTypes: SignificantEventsStatsWorkflowTypeRow[] = (
    aggregations.by_workflow?.buckets ?? []
  ).map((workflow) => ({
    workflowId: String(workflow.key),
    runs: workflow.doc_count,
    byStatus: statusMap(workflow.by_status?.buckets),
    tokens: sumTokens(workflow),
  }));

  return {
    available: true,
    totals: {
      workflowRuns,
      workflowRunsByStatus: statusMap(aggregations.by_status?.buckets),
      tokens: sumTokens(aggregations),
    },
    daily,
    workflowTypes,
  };
};
