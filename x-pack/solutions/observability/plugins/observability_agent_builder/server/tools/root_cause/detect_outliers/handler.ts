/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { tryPhase2Esql, runEsql } from '../esql_helpers';

interface DetectOutliersParams {
  index: string;
  timeField?: string;
  start: string;
  end: string;
  metricField: string;
  byFields?: string[];
  direction: 'both' | 'incr' | 'decr';
  scoreThreshold: number;
  preAggregation?: string;
  limit: number;
}

export interface OutlierResult {
  entity: Record<string, string>;
  value: number;
  score: number;
  mean: number;
  stdDev: number;
}

function buildPhase2Query(params: DetectOutliersParams): string {
  const { index, timeField, start, end, metricField, byFields, direction } = params;
  const timeFilter = timeField
    ? `| WHERE ${timeField} >= "${start}" AND ${timeField} < "${end}"`
    : '';
  const dirClause = direction !== 'both' ? ` ${direction.toUpperCase()}` : '';
  const byClause = byFields?.length ? ` BY ${byFields.join(', ')}` : '';
  const orderClause = timeField ? ` ORDER ${timeField}` : '';

  return [
    `FROM ${index}`,
    timeFilter,
    params.preAggregation ? `| ${params.preAggregation}` : '',
    `| OUTLIER ${metricField}${orderClause}${dirClause}${byClause} AS score`,
    `| WHERE score > ${params.scoreThreshold}`,
    `| SORT score DESC`,
    `| LIMIT ${params.limit}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Phase 1: compute z-scores using INLINE STATS for population-based outlier detection.
 * Score is -log10(p-value) where p-value comes from the normal distribution.
 */
async function runPhase1(
  esClient: ElasticsearchClient,
  params: DetectOutliersParams,
  logger: Logger
): Promise<OutlierResult[]> {
  const { index, timeField, start, end, metricField, byFields, limit } = params;

  const timeFilter = timeField
    ? `WHERE ${timeField} >= "${start}" AND ${timeField} < "${end}"`
    : '';

  const byClause = byFields?.length ? ` BY ${byFields.join(', ')}` : '';

  const query = [
    `FROM ${index}`,
    timeFilter ? `| ${timeFilter}` : '',
    params.preAggregation ? `| ${params.preAggregation}` : '',
    `| INLINE STATS _mean = AVG(${metricField}), _std = SQRT(AVG(POW(${metricField} - AVG(${metricField}), 2))), _count = COUNT(*)${byClause}`,
    `| EVAL _zscore = CASE(_std > 0, ABS(${metricField} - _mean) / _std, 0)`,
    `| EVAL _score = CASE(_zscore > 0, _zscore * _zscore / 2 * LOG10(EULER()), 0)`,
    `| WHERE _score > ${params.scoreThreshold}`,
    `| SORT _score DESC`,
    `| LIMIT ${limit}`,
  ]
    .filter(Boolean)
    .join(' ');

  logger.debug(`detect_outliers phase 1 query: ${query}`);

  let result;
  try {
    result = await runEsql({ esClient, query });
  } catch (queryError) {
    logger.debug(`Complex ES|QL failed, trying simplified approach: ${queryError.message}`);
    return await runPhase1Simplified(esClient, params, logger);
  }

  const colIdx = (name: string) => result.columns.findIndex((c) => c.name === name);
  const metricIdx = colIdx(metricField);
  const scoreIdx = colIdx('_score');
  const meanIdx = colIdx('_mean');
  const stdIdx = colIdx('_std');
  const byColIndices = (byFields ?? []).map((f) => colIdx(f));

  return result.values.map((row) => {
    const entity: Record<string, string> = {};
    for (let i = 0; i < (byFields ?? []).length; i++) {
      entity[byFields![i]] = String(row[byColIndices[i]]);
    }
    return {
      entity,
      value: Number(row[metricIdx]),
      score: Number(row[scoreIdx]),
      mean: Number(row[meanIdx]),
      stdDev: Number(row[stdIdx]),
    };
  });
}

/**
 * Simplified Phase 1: two-pass approach when INLINE STATS is too complex.
 * First get population stats, then find outliers.
 */
async function runPhase1Simplified(
  esClient: ElasticsearchClient,
  params: DetectOutliersParams,
  logger: Logger
): Promise<OutlierResult[]> {
  const { index, timeField, start, end, metricField, byFields, limit } = params;

  const timeFilter = timeField
    ? `WHERE ${timeField} >= "${start}" AND ${timeField} < "${end}"`
    : '';

  const byClause = byFields?.length ? ` BY ${byFields.join(', ')}` : '';

  const statsQuery = [
    `FROM ${index}`,
    timeFilter ? `| ${timeFilter}` : '',
    params.preAggregation ? `| ${params.preAggregation}` : '',
    `| STATS _mean = AVG(${metricField}), _std = SQRT(AVG(POW(${metricField}, 2)) - POW(AVG(${metricField}), 2))${byClause}`,
  ]
    .filter(Boolean)
    .join(' ');

  logger.debug(`detect_outliers simplified stats query: ${statsQuery}`);
  const statsResult = await runEsql({ esClient, query: statsQuery });

  if (statsResult.values.length === 0) return [];

  const meanIdx = statsResult.columns.findIndex((c) => c.name === '_mean');
  const stdIdx = statsResult.columns.findIndex((c) => c.name === '_std');
  const mean = Number(statsResult.values[0][meanIdx]);
  const std = Number(statsResult.values[0][stdIdx]) || 1;

  const threshold = mean + params.scoreThreshold * std;
  const filterExpr =
    params.direction === 'decr'
      ? `${metricField} < ${mean - params.scoreThreshold * std}`
      : params.direction === 'incr'
      ? `${metricField} > ${threshold}`
      : `${metricField} > ${threshold} OR ${metricField} < ${mean - params.scoreThreshold * std}`;

  const detailQuery = [
    `FROM ${index}`,
    timeFilter ? `| ${timeFilter}` : '',
    params.preAggregation ? `| ${params.preAggregation}` : '',
    `| WHERE ${filterExpr}`,
    `| EVAL _score = ABS(${metricField} - ${mean}) / ${std}`,
    `| SORT _score DESC`,
    `| LIMIT ${limit}`,
  ]
    .filter(Boolean)
    .join(' ');

  logger.debug(`detect_outliers simplified detail query: ${detailQuery}`);
  const detailResult = await runEsql({ esClient, query: detailQuery });

  const metricColIdx = detailResult.columns.findIndex((c) => c.name === metricField);
  const scoreColIdx = detailResult.columns.findIndex((c) => c.name === '_score');
  const byColIndices = (byFields ?? []).map((f) =>
    detailResult.columns.findIndex((c) => c.name === f)
  );

  return detailResult.values.map((row) => {
    const entity: Record<string, string> = {};
    for (let i = 0; i < (byFields ?? []).length; i++) {
      entity[byFields![i]] = String(row[byColIndices[i]]);
    }
    return {
      entity,
      value: Number(row[metricColIdx]),
      score: Number(row[scoreColIdx]),
      mean,
      stdDev: std,
    };
  });
}

export async function detectOutliersHandler({
  esClient,
  logger,
  params,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
  params: DetectOutliersParams;
}): Promise<{ phase: 1 | 2; results: OutlierResult[]; query?: string }> {
  const phase2Query = buildPhase2Query(params);
  const phase2Result = await tryPhase2Esql({ esClient, query: phase2Query });

  if (phase2Result) {
    const results: OutlierResult[] = phase2Result.values.map((row) => {
      const obj: Record<string, unknown> = {};
      phase2Result.columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      const entity: Record<string, string> = {};
      for (const f of params.byFields ?? []) {
        entity[f] = String(obj[f] ?? '');
      }
      return {
        entity,
        value: Number(obj[params.metricField] ?? 0),
        score: Number(obj.score ?? 0),
        mean: Number(obj._mean ?? 0),
        stdDev: Number(obj._std ?? 0),
      };
    });
    return { phase: 2, results, query: phase2Query };
  }

  logger.debug('OUTLIER command not available, falling back to phase 1');
  const results = await runPhase1(esClient, params, logger);
  return { phase: 1, results };
}
