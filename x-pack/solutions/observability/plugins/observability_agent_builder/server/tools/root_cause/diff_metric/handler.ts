/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { tryPhase2Esql, runEsql } from '../esql_helpers';

interface DiffMetricParams {
  index: string;
  timeField: string;
  start: string;
  end: string;
  metricField: string;
  testExpression: string;
  baselineExpression?: string;
  byFields: string[];
  normalize: 'std_dev' | 'mean';
  direction: 'both' | 'incr' | 'decr';
  riskThreshold: number;
  significanceThreshold: number;
  limit: number;
}

export interface DiffMetricResult {
  partition: Record<string, string>;
  wasserstein: number;
  pValue: number;
  meanBaseline: number;
  meanTest: number;
  stdBaseline: number;
  stdTest: number;
  countBaseline: number;
  countTest: number;
}

function buildPhase2Query(params: DiffMetricParams): string {
  const {
    index,
    timeField,
    start,
    end,
    metricField,
    testExpression,
    baselineExpression,
    byFields,
    normalize,
    direction,
  } = params;
  const byClause = byFields.join(', ');
  const dirClause = direction !== 'both' ? ` ${direction.toUpperCase()}` : '';
  const normClause = ` NORMALIZE ${normalize === 'std_dev' ? 'STD_DEV' : 'MEAN'}`;
  const vsClause = baselineExpression ? ` VS ${baselineExpression}` : '';

  return [
    `FROM ${index}`,
    `| WHERE ${timeField} >= "${start}" AND ${timeField} < "${end}"`,
    `| DIFF_METRIC risk = WASSERSTEIN(${metricField})${normClause}, prob = ANDERSON_DARLING(${metricField})${dirClause} BY ${byClause} TEST ${testExpression}${vsClause}`,
    `| WHERE (risk >= ${params.riskThreshold} OR risk <= ${1 / params.riskThreshold}) AND prob < ${
      params.significanceThreshold
    }`,
    `| SORT risk DESC`,
    `| LIMIT ${params.limit}`,
  ].join(' ');
}

/**
 * Phase 1: use FORK-style STATS to compute per-partition statistics,
 * then approximate Wasserstein distance and a distribution test.
 *
 * The Wasserstein distance between two normal distributions is:
 *   W = |μ1 - μ2| + |σ1 - σ2| * sqrt(2/π)
 * We normalize by dividing by the baseline std_dev or mean.
 *
 * For significance, we use the two-sample t-test as an approximation
 * of the Anderson-Darling test (which requires raw samples).
 */
async function runPhase1(
  esClient: ElasticsearchClient,
  params: DiffMetricParams,
  logger: Logger
): Promise<DiffMetricResult[]> {
  const {
    index,
    timeField,
    start,
    end,
    metricField,
    testExpression,
    baselineExpression,
    byFields,
    limit,
  } = params;
  const byClause = byFields.join(', ');
  const baselineExpr = baselineExpression ?? `NOT (${testExpression})`;

  const query = [
    `FROM ${index}`,
    `| WHERE ${timeField} >= "${start}" AND ${timeField} < "${end}"`,
    `| STATS avg_val = AVG(${metricField}), std_val = SQRT(AVG(POW(${metricField} - AVG(${metricField}), 2))), cnt = COUNT(*) BY ${byClause}, _partition = CASE(${testExpression}, "test", ${baselineExpr}, "baseline")`,
  ].join(' ');

  logger.debug(`diff_metric phase 1 query: ${query}`);
  const result = await runEsql({ esClient, query });

  const colIdx = (name: string) => result.columns.findIndex((c) => c.name === name);
  const avgIdx = colIdx('avg_val');
  const stdIdx = colIdx('std_val');
  const cntIdx = colIdx('cnt');
  const partIdx = colIdx('_partition');
  const byColIndices = byFields.map((f) => colIdx(f));

  const groups = new Map<
    string,
    {
      partition: Record<string, string>;
      baseline: { avg: number; std: number; count: number };
      test: { avg: number; std: number; count: number };
    }
  >();

  for (const row of result.values) {
    const part = String(row[partIdx]);
    const key = byColIndices.map((i) => String(row[i])).join('|||');
    const partitionObj: Record<string, string> = {};
    for (let i = 0; i < byFields.length; i++) {
      partitionObj[byFields[i]] = String(row[byColIndices[i]]);
    }

    if (!groups.has(key)) {
      groups.set(key, {
        partition: partitionObj,
        baseline: { avg: 0, std: 0, count: 0 },
        test: { avg: 0, std: 0, count: 0 },
      });
    }
    const group = groups.get(key)!;
    const stats = {
      avg: Number(row[avgIdx]),
      std: Number(row[stdIdx]),
      count: Number(row[cntIdx]),
    };
    if (part === 'baseline') {
      group.baseline = stats;
    } else if (part === 'test') {
      group.test = stats;
    }
  }

  const results: DiffMetricResult[] = [];
  const numGroups = groups.size;

  for (const group of groups.values()) {
    if (group.baseline.count === 0 || group.test.count === 0) continue;

    const normalizer =
      params.normalize === 'std_dev' ? group.baseline.std || 1 : group.baseline.avg || 1;

    const meanDiff = Math.abs(group.test.avg - group.baseline.avg);
    const stdDiff = Math.abs(group.test.std - group.baseline.std) * Math.sqrt(2 / Math.PI);
    const wasserstein = (meanDiff + stdDiff) / Math.abs(normalizer);

    const pValue = twoSampleTTestPValue(
      group.baseline.avg,
      group.baseline.std,
      group.baseline.count,
      group.test.avg,
      group.test.std,
      group.test.count
    );
    const correctedPValue = Math.min(pValue * numGroups, 1);

    results.push({
      partition: group.partition,
      wasserstein,
      pValue: correctedPValue,
      meanBaseline: group.baseline.avg,
      meanTest: group.test.avg,
      stdBaseline: group.baseline.std,
      stdTest: group.test.std,
      countBaseline: group.baseline.count,
      countTest: group.test.count,
    });
  }

  return filterAndSort(results, params).slice(0, limit);
}

function filterAndSort(results: DiffMetricResult[], params: DiffMetricParams): DiffMetricResult[] {
  return results
    .filter((r) => {
      const riskOk = r.wasserstein >= params.riskThreshold;
      const sigOk = r.pValue < params.significanceThreshold;
      if (!riskOk || !sigOk) return false;
      if (params.direction === 'incr') return r.meanTest > r.meanBaseline;
      if (params.direction === 'decr') return r.meanTest < r.meanBaseline;
      return true;
    })
    .sort((a, b) => b.wasserstein - a.wasserstein);
}

function twoSampleTTestPValue(
  mean1: number,
  std1: number,
  n1: number,
  mean2: number,
  std2: number,
  n2: number
): number {
  if (n1 < 2 || n2 < 2) return 1;
  const se = Math.sqrt((std1 * std1) / n1 + (std2 * std2) / n2);
  if (se === 0) return mean1 === mean2 ? 1 : 0;
  const t = Math.abs(mean2 - mean1) / se;
  const df = Math.min(n1, n2) - 1;
  return 2 * tDistCdf(-t, df);
}

function tDistCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  return 0.5 * incompleteBeta(x, df / 2, 0.5);
}

/**
 * Regularized incomplete beta function approximation via continued fraction.
 */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  let sum = 1;
  let term = 1;
  for (let n = 1; n <= 200; n++) {
    term *= ((n - a) * x) / (n * (1 + (n - a) / (n + b)));
    sum += term;
    if (Math.abs(term) < 1e-10) break;
  }

  return Math.min(front * sum, 1);
}

function lgamma(x: number): number {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.001208650973866179, -0.000005395239384953,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    ser += c[j] / ++y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

export async function diffMetricHandler({
  esClient,
  logger,
  params,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
  params: DiffMetricParams;
}): Promise<{ phase: 1 | 2; results: DiffMetricResult[]; query?: string }> {
  const phase2Query = buildPhase2Query(params);
  const phase2Result = await tryPhase2Esql({ esClient, query: phase2Query });

  if (phase2Result) {
    const results: DiffMetricResult[] = phase2Result.values.map((row) => {
      const obj: Record<string, unknown> = {};
      phase2Result.columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      const partition: Record<string, string> = {};
      for (const f of params.byFields) {
        partition[f] = String(obj[f] ?? '');
      }
      return {
        partition,
        wasserstein: Number(obj.risk ?? 0),
        pValue: Number(obj.prob ?? 1),
        meanBaseline: Number(obj.mean_baseline ?? 0),
        meanTest: Number(obj.mean_test ?? 0),
        stdBaseline: Number(obj.std_baseline ?? 0),
        stdTest: Number(obj.std_test ?? 0),
        countBaseline: Number(obj.count_baseline ?? 0),
        countTest: Number(obj.count_test ?? 0),
      };
    });
    return { phase: 2, results, query: phase2Query };
  }

  logger.debug('DIFF_METRIC not available, falling back to phase 1');
  const results = await runPhase1(esClient, params, logger);
  return { phase: 1, results };
}
