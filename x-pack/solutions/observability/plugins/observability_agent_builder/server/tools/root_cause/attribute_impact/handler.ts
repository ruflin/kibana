/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { tryPhase2Esql, runEsql } from '../esql_helpers';

interface AttributeImpactParams {
  index: string;
  timeField: string;
  start: string;
  end: string;
  metricField: string;
  testExpression: string;
  baselineExpression?: string;
  covariates: string[];
  limit: number;
}

export interface AttributeImpactResult {
  attribute: string;
  value: string;
  totalScore: number;
  mixImpact: number;
  shiftImpact: number;
  proportionBaseline: number;
  proportionTest: number;
  meanBaseline: number;
  meanTest: number;
}

function buildPhase2Query(params: AttributeImpactParams): string {
  const {
    index,
    timeField,
    start,
    end,
    metricField,
    testExpression,
    baselineExpression,
    covariates,
  } = params;
  const byClause = covariates.join(', ');
  const vsClause = baselineExpression ? ` VS ${baselineExpression}` : '';

  return [
    `FROM ${index}`,
    `| WHERE ${timeField} >= "${start}" AND ${timeField} < "${end}"`,
    `| IMPACT score = SHIFT_SHARE(${metricField}) BY ${byClause} TEST ${testExpression}${vsClause}`,
    `| SORT score DESC`,
    `| LIMIT ${params.limit}`,
  ].join(' ');
}

/**
 * Phase 1 shift-share analysis.
 *
 * For each attribute value v:
 *   score(v) = (pI(v) - pB(v)) * (meanB(v) - meanB) + pI(v) * (meanI(v) - meanB(v))
 *              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *                         mix impact                           shift impact
 *
 * Where pI(v) is the proportion of records with value v in the incident set,
 * meanB(v) is the mean metric for value v in the baseline set, etc.
 */
async function runPhase1(
  esClient: ElasticsearchClient,
  params: AttributeImpactParams,
  logger: Logger
): Promise<AttributeImpactResult[]> {
  const allResults: AttributeImpactResult[] = [];

  for (const attr of params.covariates) {
    const results = await runShiftShareForAttribute(esClient, params, attr, logger);
    allResults.push(...results);
  }

  return allResults
    .sort((a, b) => Math.abs(b.totalScore) - Math.abs(a.totalScore))
    .slice(0, params.limit);
}

async function runShiftShareForAttribute(
  esClient: ElasticsearchClient,
  params: AttributeImpactParams,
  attribute: string,
  logger: Logger
): Promise<AttributeImpactResult[]> {
  const { index, timeField, start, end, metricField, testExpression, baselineExpression } = params;
  const baselineExpr = baselineExpression ?? `NOT (${testExpression})`;

  const query = [
    `FROM ${index}`,
    `| WHERE ${timeField} >= "${start}" AND ${timeField} < "${end}"`,
    `| STATS avg_val = AVG(${metricField}), cnt = COUNT(*) BY ${attribute}, _partition = CASE(${testExpression}, "test", ${baselineExpr}, "baseline")`,
  ].join(' ');

  logger.debug(`attribute_impact phase 1 query for ${attribute}: ${query}`);
  const result = await runEsql({ esClient, query });

  const colIdx = (name: string) => result.columns.findIndex((c) => c.name === name);
  const avgIdx = colIdx('avg_val');
  const cntIdx = colIdx('cnt');
  const attrIdx = colIdx(attribute);
  const partIdx = colIdx('_partition');

  const groups = new Map<
    string,
    {
      baseline: { avg: number; count: number };
      test: { avg: number; count: number };
    }
  >();

  let totalBaseline = 0;
  let totalTest = 0;
  let sumBaselineWeighted = 0;

  for (const row of result.values) {
    const part = String(row[partIdx]);
    const val = String(row[attrIdx]);
    const avg = Number(row[avgIdx]);
    const count = Number(row[cntIdx]);

    if (!groups.has(val)) {
      groups.set(val, {
        baseline: { avg: 0, count: 0 },
        test: { avg: 0, count: 0 },
      });
    }
    const group = groups.get(val)!;
    if (part === 'baseline') {
      group.baseline = { avg, count };
      totalBaseline += count;
      sumBaselineWeighted += avg * count;
    } else if (part === 'test') {
      group.test = { avg, count };
      totalTest += count;
    }
  }

  if (totalBaseline === 0 || totalTest === 0) return [];

  const overallBaselineMean = sumBaselineWeighted / totalBaseline;
  const results: AttributeImpactResult[] = [];

  for (const [val, group] of groups) {
    const pB = group.baseline.count / totalBaseline;
    const pI = group.test.count / totalTest;
    const meanB = group.baseline.avg;
    const meanI = group.test.avg;

    const mixImpact = (pI - pB) * (meanB - overallBaselineMean);
    const shiftImpact = pI * (meanI - meanB);
    const totalScore = mixImpact + shiftImpact;

    results.push({
      attribute,
      value: val,
      totalScore,
      mixImpact,
      shiftImpact,
      proportionBaseline: pB,
      proportionTest: pI,
      meanBaseline: meanB,
      meanTest: meanI,
    });
  }

  return results;
}

export async function attributeImpactHandler({
  esClient,
  logger,
  params,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
  params: AttributeImpactParams;
}): Promise<{ phase: 1 | 2; results: AttributeImpactResult[]; query?: string }> {
  const phase2Query = buildPhase2Query(params);
  const phase2Result = await tryPhase2Esql({ esClient, query: phase2Query });

  if (phase2Result) {
    const results: AttributeImpactResult[] = phase2Result.values.map((row) => {
      const obj: Record<string, unknown> = {};
      phase2Result.columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      return {
        attribute: String(obj.attribute ?? ''),
        value: String(obj.value ?? ''),
        totalScore: Number(obj.score ?? 0),
        mixImpact: Number(obj.mix_impact ?? 0),
        shiftImpact: Number(obj.shift_impact ?? 0),
        proportionBaseline: Number(obj.proportion_baseline ?? 0),
        proportionTest: Number(obj.proportion_test ?? 0),
        meanBaseline: Number(obj.mean_baseline ?? 0),
        meanTest: Number(obj.mean_test ?? 0),
      };
    });
    return { phase: 2, results, query: phase2Query };
  }

  logger.debug('IMPACT SHIFT_SHARE not available, falling back to phase 1');
  const results = await runPhase1(esClient, params, logger);
  return { phase: 1, results };
}
