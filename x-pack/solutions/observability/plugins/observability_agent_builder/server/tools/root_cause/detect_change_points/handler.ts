/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { tryPhase2Esql, runEsql } from '../esql_helpers';

interface DetectChangePointsParams {
  index: string;
  timeField: string;
  start: string;
  end: string;
  metricField: string;
  byFields?: string[];
  bucketSize: string;
  maxChanges: number;
}

export interface ChangePointResult {
  partition: Record<string, string>;
  timestamp: string;
  changeType: 'trend_change' | 'step_change' | 'unknown';
  valueBefore: number;
  valueAfter: number;
  score: number;
}

function buildPhase2Query(params: DetectChangePointsParams): string {
  const { index, timeField, start, end, metricField, byFields, bucketSize, maxChanges } = params;
  const byClause = byFields?.length ? ` BY ${byFields.join(', ')}` : '';

  return [
    `FROM ${index}`,
    `| WHERE ${timeField} >= "${start}" AND ${timeField} < "${end}"`,
    `| STATS avg_val = AVG(${metricField}) BY bucket = BUCKET(${timeField}, ${bucketSize})${
      byClause ? `, ${byFields!.join(', ')}` : ''
    }`,
    `| CHANGE_POINT avg_val ORDER bucket${byClause}`,
    `| LIMIT ${maxChanges}`,
  ].join(' ');
}

/**
 * Phase 1: bucket the metric, then detect change points using a sliding window
 * approach comparing adjacent windows with a t-test.
 */
async function runPhase1(
  esClient: ElasticsearchClient,
  params: DetectChangePointsParams,
  logger: Logger
): Promise<ChangePointResult[]> {
  const { index, timeField, start, end, metricField, byFields, bucketSize, maxChanges } = params;
  const byClause = byFields?.length ? `, ${byFields.join(', ')}` : '';

  const query = [
    `FROM ${index}`,
    `| WHERE ${timeField} >= "${start}" AND ${timeField} < "${end}"`,
    `| STATS avg_val = AVG(${metricField}), count_val = COUNT(*) BY bucket = BUCKET(${timeField}, ${bucketSize})${byClause}`,
    `| SORT bucket ASC`,
  ].join(' ');

  logger.debug(`detect_change_points phase 1 query: ${query}`);
  const result = await runEsql({ esClient, query });

  const colIdx = (name: string) => result.columns.findIndex((c) => c.name === name);
  const bucketIdx = colIdx('bucket');
  const avgIdx = colIdx('avg_val');
  const byColIndices = (byFields ?? []).map((f) => colIdx(f));

  const partitions = new Map<string, Array<{ bucket: string; avg: number }>>();

  for (const row of result.values) {
    const key = byColIndices.map((i) => String(row[i])).join('|||');
    if (!partitions.has(key)) {
      partitions.set(key, []);
    }
    partitions.get(key)!.push({
      bucket: String(row[bucketIdx]),
      avg: Number(row[avgIdx]),
    });
  }

  const allResults: ChangePointResult[] = [];

  for (const [key, series] of partitions) {
    if (series.length < 4) continue;

    const partitionObj: Record<string, string> = {};
    if (byFields?.length) {
      const parts = key.split('|||');
      for (let i = 0; i < byFields.length; i++) {
        partitionObj[byFields[i]] = parts[i];
      }
    }

    const changePoints = findChangePointsSlidingWindow(series, maxChanges);
    for (const cp of changePoints) {
      allResults.push({
        partition: partitionObj,
        timestamp: cp.timestamp,
        changeType: cp.changeType,
        valueBefore: cp.valueBefore,
        valueAfter: cp.valueAfter,
        score: cp.score,
      });
    }
  }

  return allResults.sort((a, b) => b.score - a.score).slice(0, maxChanges);
}

interface RawChangePoint {
  timestamp: string;
  changeType: 'trend_change' | 'step_change' | 'unknown';
  valueBefore: number;
  valueAfter: number;
  score: number;
}

/**
 * Sliding window change point detection.
 * Compares the mean of a left window to a right window at each position.
 * Uses the ratio of between-window variance to within-window variance as score.
 */
function findChangePointsSlidingWindow(
  series: Array<{ bucket: string; avg: number }>,
  maxChanges: number
): RawChangePoint[] {
  const values = series.map((s) => s.avg);
  const n = values.length;
  const minWindow = Math.max(2, Math.floor(n / 8));
  const candidates: RawChangePoint[] = [];

  for (let i = minWindow; i < n - minWindow; i++) {
    const left = values.slice(Math.max(0, i - minWindow * 2), i);
    const right = values.slice(i, Math.min(n, i + minWindow * 2));

    if (left.length < 2 || right.length < 2) continue;

    const meanLeft = mean(left);
    const meanRight = mean(right);
    const varLeft = variance(left);
    const varRight = variance(right);
    const pooledVar =
      (varLeft * (left.length - 1) + varRight * (right.length - 1)) /
      (left.length + right.length - 2);

    if (pooledVar === 0) continue;

    const fScore = Math.pow(meanRight - meanLeft, 2) / pooledVar;

    if (fScore > 4) {
      const trendLeft = linearSlope(left);
      const trendRight = linearSlope(right);
      const changeType: 'trend_change' | 'step_change' =
        Math.abs(trendRight - trendLeft) > Math.abs(meanRight - meanLeft) / left.length
          ? 'trend_change'
          : 'step_change';

      candidates.push({
        timestamp: series[i].bucket,
        changeType,
        valueBefore: meanLeft,
        valueAfter: meanRight,
        score: fScore,
      });
    }
  }

  return deduplicateChangePoints(candidates, minWindow).slice(0, maxChanges);
}

function deduplicateChangePoints(candidates: RawChangePoint[], minGap: number): RawChangePoint[] {
  const sorted = candidates.sort((a, b) => b.score - a.score);
  const selected: RawChangePoint[] = [];
  const usedIndices = new Set<number>();

  for (const cp of sorted) {
    const cpIdx = candidates.indexOf(cp);
    let tooClose = false;
    for (const usedIdx of usedIndices) {
      if (Math.abs(cpIdx - usedIdx) < minGap) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      selected.push(cp);
      usedIndices.add(cpIdx);
    }
  }

  return selected;
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function variance(arr: number[]): number {
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) * (v - m), 0) / (arr.length - 1);
}

function linearSlope(arr: number[]): number {
  const n = arr.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(arr);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (arr[i] - yMean);
    den += (i - xMean) * (i - xMean);
  }
  return den === 0 ? 0 : num / den;
}

export async function detectChangePointsHandler({
  esClient,
  logger,
  params,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
  params: DetectChangePointsParams;
}): Promise<{ phase: 1 | 2; results: ChangePointResult[]; query?: string }> {
  const phase2Query = buildPhase2Query(params);
  const phase2Result = await tryPhase2Esql({ esClient, query: phase2Query });

  if (phase2Result) {
    const results: ChangePointResult[] = phase2Result.values.map((row) => {
      const obj: Record<string, unknown> = {};
      phase2Result.columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      const partition: Record<string, string> = {};
      for (const f of params.byFields ?? []) {
        partition[f] = String(obj[f] ?? '');
      }
      return {
        partition,
        timestamp: String(obj.bucket ?? ''),
        changeType: String(obj.change_type ?? 'unknown') as ChangePointResult['changeType'],
        valueBefore: Number(obj.value_before ?? 0),
        valueAfter: Number(obj.value_after ?? 0),
        score: Number(obj.score ?? 0),
      };
    });
    return { phase: 2, results, query: phase2Query };
  }

  logger.debug('CHANGE_POINT multi not available, falling back to phase 1');
  const results = await runPhase1(esClient, params, logger);
  return { phase: 1, results };
}
