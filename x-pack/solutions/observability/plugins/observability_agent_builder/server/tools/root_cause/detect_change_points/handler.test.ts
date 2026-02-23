/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { detectChangePointsHandler } from './handler';

describe('detectChangePointsHandler', () => {
  const baseParams = {
    index: 'metrics-*',
    timeField: '@timestamp',
    start: '2024-01-15T00:00:00Z',
    end: '2024-01-15T12:00:00Z',
    metricField: 'system.cpu.total.pct',
    bucketSize: '1h',
    maxChanges: 5,
  };

  it('falls back to phase 1 when CHANGE_POINT multi is not available', async () => {
    const values: any[][] = [];
    // Simulate a step change at bucket 6: low values then high values
    for (let i = 0; i < 12; i++) {
      const timestamp = `2024-01-15T${String(i).padStart(2, '0')}:00:00.000Z`;
      const avg = i < 6 ? 0.2 + Math.random() * 0.05 : 0.8 + Math.random() * 0.05;
      values.push([timestamp, avg, 100]);
    }

    const esClient = {
      esql: {
        query: jest
          .fn()
          .mockRejectedValueOnce(new Error('Unknown command [CHANGE_POINT]'))
          .mockResolvedValueOnce({
            columns: [
              { name: 'bucket', type: 'date' },
              { name: 'avg_val', type: 'double' },
              { name: 'count_val', type: 'long' },
            ],
            values,
          }),
      },
    } as any;

    const result = await detectChangePointsHandler({
      esClient,
      logger: { debug: jest.fn(), error: jest.fn() } as any,
      params: baseParams,
    });

    expect(result.phase).toBe(1);
    expect(result.results.length).toBeGreaterThan(0);

    const cp = result.results[0];
    expect(cp.changeType).toBeDefined();
    expect(cp.score).toBeGreaterThan(0);
    expect(cp.valueAfter).toBeGreaterThan(cp.valueBefore);
  });

  it('returns empty results for flat time series', async () => {
    const values: any[][] = [];
    for (let i = 0; i < 12; i++) {
      const timestamp = `2024-01-15T${String(i).padStart(2, '0')}:00:00.000Z`;
      values.push([timestamp, 0.5, 100]);
    }

    const esClient = {
      esql: {
        query: jest
          .fn()
          .mockRejectedValueOnce(new Error('Unknown command'))
          .mockResolvedValueOnce({
            columns: [
              { name: 'bucket', type: 'date' },
              { name: 'avg_val', type: 'double' },
              { name: 'count_val', type: 'long' },
            ],
            values,
          }),
      },
    } as any;

    const result = await detectChangePointsHandler({
      esClient,
      logger: { debug: jest.fn(), error: jest.fn() } as any,
      params: baseParams,
    });

    expect(result.phase).toBe(1);
    expect(result.results).toHaveLength(0);
  });

  it('detects multiple change points', async () => {
    const values: any[][] = [];
    for (let i = 0; i < 24; i++) {
      const timestamp = `2024-01-15T${String(i).padStart(2, '0')}:00:00.000Z`;
      let avg: number;
      if (i < 8) avg = 0.2;
      else if (i < 16) avg = 0.8;
      else avg = 0.3;
      values.push([timestamp, avg, 100]);
    }

    const esClient = {
      esql: {
        query: jest
          .fn()
          .mockRejectedValueOnce(new Error('Unknown command'))
          .mockResolvedValueOnce({
            columns: [
              { name: 'bucket', type: 'date' },
              { name: 'avg_val', type: 'double' },
              { name: 'count_val', type: 'long' },
            ],
            values,
          }),
      },
    } as any;

    const result = await detectChangePointsHandler({
      esClient,
      logger: { debug: jest.fn(), error: jest.fn() } as any,
      params: { ...baseParams, end: '2024-01-16T00:00:00Z', maxChanges: 5 },
    });

    expect(result.phase).toBe(1);
    expect(result.results.length).toBeGreaterThanOrEqual(2);
  });
});
