/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Returns a human-meaningful histogram bucket interval in milliseconds.
 *
 * Uses the same breakpoints as the Streams list Documents sparkline so counts
 * stay comparable for a given time range.
 */
export function getMeaningfulBucketMs(rangeMs: number, numDataPoints: number): number {
  if (rangeMs < 15 * MINUTE_MS) return Math.floor(rangeMs / numDataPoints);
  if (rangeMs <= HOUR_MS) return MINUTE_MS;
  if (rangeMs <= 6 * HOUR_MS) return 5 * MINUTE_MS;
  if (rangeMs <= DAY_MS) return 15 * MINUTE_MS;
  if (rangeMs <= 3 * DAY_MS) return HOUR_MS;
  if (rangeMs <= 10 * DAY_MS) return 6 * HOUR_MS;
  return DAY_MS;
}

/** Ingest histogram: doc_count by @timestamp bucket (`intervalMs` snapped to a meaningful interval). */
export function buildStreamIngestHistogramEsql(source: string, intervalMs: number): string {
  return esql.from(source)
    .pipe`STATS doc_count = COUNT(*) BY @timestamp = BUCKET(@timestamp, ${intervalMs} ms)`.print(
    'basic'
  );
}
