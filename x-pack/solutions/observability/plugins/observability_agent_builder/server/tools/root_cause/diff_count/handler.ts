/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { tryPhase2Esql, runEsql } from '../esql_helpers';

interface DiffCountParams {
  index: string;
  timeField: string;
  start: string;
  end: string;
  testExpression: string;
  baselineExpression?: string;
  byFields: string[];
  direction: 'both' | 'incr' | 'decr';
  riskThreshold: number;
  significanceThreshold: number;
  limit: number;
}

export interface DiffCountResult {
  category: Record<string, string>;
  relativeRisk: number;
  pValue: number;
  countBaseline: number;
  countTest: number;
  totalBaseline: number;
  totalTest: number;
}

/**
 * Phase 2: attempt the proposed DIFF_COUNT ES|QL command.
 */
function buildPhase2Query(params: DiffCountParams): string {
  const { index, timeField, start, end, testExpression, baselineExpression, byFields, direction } =
    params;
  const byClause = byFields.join(', ');
  const dirClause = direction !== 'both' ? ` ${direction.toUpperCase()}` : '';
  const vsClause = baselineExpression ? ` VS ${baselineExpression}` : '';

  return [
    `FROM ${index}`,
    `| WHERE ${timeField} >= "${start}" AND ${timeField} < "${end}"`,
    `| DIFF_COUNT risk = RELATIVE_RISK(), prob = FISCHER_EXACT_TEST()${dirClause} BY ${byClause} TEST ${testExpression}${vsClause}`,
    `| WHERE (risk >= ${params.riskThreshold} OR risk <= ${1 / params.riskThreshold}) AND prob < ${
      params.significanceThreshold
    }`,
    `| SORT risk DESC`,
    `| LIMIT ${params.limit}`,
  ].join(' ');
}

/**
 * Phase 1: use FORK + STATS to compute counts, then calculate relative risk
 * and Fisher's exact test p-value in the handler.
 */
async function runPhase1(
  esClient: ElasticsearchClient,
  params: DiffCountParams,
  logger: Logger
): Promise<DiffCountResult[]> {
  const { index, timeField, start, end, testExpression, baselineExpression, byFields, limit } =
    params;
  const byClause = byFields.join(', ');
  const baselineExpr = baselineExpression ?? `NOT (${testExpression})`;

  const query = [
    `FROM ${index}`,
    `| WHERE ${timeField} >= "${start}" AND ${timeField} < "${end}"`,
    `| STATS count = COUNT(*) BY ${byClause}, _partition = CASE(${testExpression}, "test", ${baselineExpr}, "baseline")`,
  ].join(' ');

  logger.debug(`diff_count phase 1 query: ${query}`);
  const result = await runEsql({ esClient, query });

  const partitionColIdx = result.columns.findIndex((c) => c.name === '_partition');
  const countColIdx = result.columns.findIndex((c) => c.name === 'count');
  const byColIndices = byFields.map((f) => result.columns.findIndex((c) => c.name === f));

  const groups = new Map<
    string,
    { category: Record<string, string>; baseline: number; test: number }
  >();

  let totalBaseline = 0;
  let totalTest = 0;

  for (const row of result.values) {
    const partition = String(row[partitionColIdx]);
    const count = Number(row[countColIdx]);
    const key = byColIndices.map((i) => String(row[i])).join('|||');
    const category: Record<string, string> = {};
    for (let i = 0; i < byFields.length; i++) {
      category[byFields[i]] = String(row[byColIndices[i]]);
    }

    if (!groups.has(key)) {
      groups.set(key, { category, baseline: 0, test: 0 });
    }
    const group = groups.get(key)!;
    if (partition === 'baseline') {
      group.baseline += count;
      totalBaseline += count;
    } else if (partition === 'test') {
      group.test += count;
      totalTest += count;
    }
  }

  if (totalBaseline === 0 || totalTest === 0) {
    return [];
  }

  const numCategories = groups.size;
  const results: DiffCountResult[] = [];

  for (const group of groups.values()) {
    const pBaseline = group.baseline / totalBaseline;
    const pTest = group.test / totalTest;

    const relativeRisk = pBaseline > 0 ? pTest / pBaseline : pTest > 0 ? Infinity : 1;

    const pValue = fisherExactPValue(
      group.test,
      totalTest - group.test,
      group.baseline,
      totalBaseline - group.baseline
    );

    const correctedPValue = Math.min(pValue * numCategories, 1);

    results.push({
      category: group.category,
      relativeRisk,
      pValue: correctedPValue,
      countBaseline: group.baseline,
      countTest: group.test,
      totalBaseline,
      totalTest,
    });
  }

  return filterAndSort(results, params).slice(0, limit);
}

function filterAndSort(results: DiffCountResult[], params: DiffCountParams): DiffCountResult[] {
  return results
    .filter((r) => {
      const riskOk =
        r.relativeRisk >= params.riskThreshold || r.relativeRisk <= 1 / params.riskThreshold;
      const sigOk = r.pValue < params.significanceThreshold;
      if (!riskOk || !sigOk) return false;
      if (params.direction === 'incr') return r.relativeRisk >= params.riskThreshold;
      if (params.direction === 'decr') return r.relativeRisk <= 1 / params.riskThreshold;
      return true;
    })
    .sort((a, b) => Math.abs(Math.log(b.relativeRisk)) - Math.abs(Math.log(a.relativeRisk)));
}

/**
 * Approximate Fisher's exact test p-value using the log-space hypergeometric
 * distribution. For large counts this uses a normal approximation.
 */
function fisherExactPValue(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;

  if (n === 0 || r1 === 0 || r2 === 0 || c1 === 0) return 1;

  const expected = (r1 * c1) / n;
  const variance = (r1 * r2 * c1 * (n - c1)) / (n * n * (n - 1));

  if (variance <= 0) return 1;

  const z = (Math.abs(a - expected) - 0.5) / Math.sqrt(variance);
  return 2 * normalCdf(-z);
}

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327;
  const p =
    d *
    Math.exp((-x * x) / 2) *
    t *
    (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.3302744))));
  return x > 0 ? 1 - p : p;
}

export async function diffCountHandler({
  esClient,
  logger,
  params,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
  params: DiffCountParams;
}): Promise<{ phase: 1 | 2; results: DiffCountResult[]; query?: string }> {
  const phase2Query = buildPhase2Query(params);
  const phase2Result = await tryPhase2Esql({ esClient, query: phase2Query });

  if (phase2Result) {
    const results: DiffCountResult[] = phase2Result.values.map((row) => {
      const obj: Record<string, unknown> = {};
      phase2Result.columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      const category: Record<string, string> = {};
      for (const f of params.byFields) {
        category[f] = String(obj[f] ?? '');
      }
      return {
        category,
        relativeRisk: Number(obj.risk ?? 0),
        pValue: Number(obj.prob ?? 1),
        countBaseline: Number(obj.count_baseline ?? 0),
        countTest: Number(obj.count_test ?? 0),
        totalBaseline: Number(obj.total_baseline ?? 0),
        totalTest: Number(obj.total_test ?? 0),
      };
    });
    return { phase: 2, results, query: phase2Query };
  }

  logger.debug('DIFF_COUNT not available, falling back to phase 1');
  const results = await runPhase1(esClient, params, logger);
  return { phase: 1, results };
}
