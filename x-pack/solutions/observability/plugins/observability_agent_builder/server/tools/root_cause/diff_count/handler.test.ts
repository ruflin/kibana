/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { diffCountHandler } from './handler';

const createMockEsClient = (mockResponse: { columns: any[]; values: any[][] }) => {
  return {
    esql: {
      query: jest.fn().mockResolvedValue(mockResponse),
    },
  } as any;
};

describe('diffCountHandler', () => {
  const baseParams = {
    index: 'logs-*',
    timeField: '@timestamp',
    start: '2024-01-15T09:00:00Z',
    end: '2024-01-15T11:00:00Z',
    testExpression: '@timestamp >= "2024-01-15T10:00:00Z"',
    byFields: ['log.level'],
    direction: 'both' as const,
    riskThreshold: 2.0,
    significanceThreshold: 0.05,
    limit: 10,
  };

  it('falls back to phase 1 when DIFF_COUNT is not available', async () => {
    const esClient = {
      esql: {
        query: jest
          .fn()
          .mockRejectedValueOnce(new Error('Unknown command [DIFF_COUNT]'))
          .mockResolvedValueOnce({
            columns: [
              { name: 'log.level', type: 'keyword' },
              { name: 'count', type: 'long' },
              { name: '_partition', type: 'keyword' },
            ],
            values: [
              ['error', 100, 'baseline'],
              ['error', 500, 'test'],
              ['info', 900, 'baseline'],
              ['info', 500, 'test'],
            ],
          }),
      },
    } as any;

    const result = await diffCountHandler({
      esClient,
      logger: { debug: jest.fn(), error: jest.fn() } as any,
      params: baseParams,
    });

    expect(result.phase).toBe(1);
    expect(result.results.length).toBeGreaterThan(0);

    const errorResult = result.results.find((r) => r.category['log.level'] === 'error');
    expect(errorResult).toBeDefined();
    expect(errorResult!.relativeRisk).toBeGreaterThan(1);
    expect(errorResult!.countBaseline).toBe(100);
    expect(errorResult!.countTest).toBe(500);
  });

  it('uses phase 2 when DIFF_COUNT is available', async () => {
    const esClient = createMockEsClient({
      columns: [
        { name: 'log.level', type: 'keyword' },
        { name: 'risk', type: 'double' },
        { name: 'prob', type: 'double' },
        { name: 'count_baseline', type: 'long' },
        { name: 'count_test', type: 'long' },
        { name: 'total_baseline', type: 'long' },
        { name: 'total_test', type: 'long' },
      ],
      values: [['error', 5.0, 0.001, 100, 500, 1000, 1000]],
    });

    const result = await diffCountHandler({
      esClient,
      logger: { debug: jest.fn(), error: jest.fn() } as any,
      params: baseParams,
    });

    expect(result.phase).toBe(2);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].relativeRisk).toBe(5.0);
    expect(result.results[0].pValue).toBe(0.001);
    expect(result.query).toContain('DIFF_COUNT');
  });

  it('computes correct relative risk for phase 1', async () => {
    const esClient = {
      esql: {
        query: jest
          .fn()
          .mockRejectedValueOnce(new Error('Unknown command [DIFF_COUNT]'))
          .mockResolvedValueOnce({
            columns: [
              { name: 'service.name', type: 'keyword' },
              { name: 'count', type: 'long' },
              { name: '_partition', type: 'keyword' },
            ],
            values: [
              ['svc-a', 10, 'baseline'],
              ['svc-a', 50, 'test'],
              ['svc-b', 90, 'baseline'],
              ['svc-b', 50, 'test'],
            ],
          }),
      },
    } as any;

    const result = await diffCountHandler({
      esClient,
      logger: { debug: jest.fn(), error: jest.fn() } as any,
      params: { ...baseParams, byFields: ['service.name'] },
    });

    expect(result.phase).toBe(1);

    const svcA = result.results.find((r) => r.category['service.name'] === 'svc-a');
    expect(svcA).toBeDefined();
    // svc-a: baseline 10/100 = 0.1, test 50/100 = 0.5, risk = 0.5/0.1 = 5.0
    expect(svcA!.relativeRisk).toBe(5);
  });

  it('filters by direction when set to incr', async () => {
    const esClient = {
      esql: {
        query: jest
          .fn()
          .mockRejectedValueOnce(new Error('Unknown command [DIFF_COUNT]'))
          .mockResolvedValueOnce({
            columns: [
              { name: 'log.level', type: 'keyword' },
              { name: 'count', type: 'long' },
              { name: '_partition', type: 'keyword' },
            ],
            values: [
              ['error', 10, 'baseline'],
              ['error', 100, 'test'],
              ['info', 100, 'baseline'],
              ['info', 10, 'test'],
            ],
          }),
      },
    } as any;

    const result = await diffCountHandler({
      esClient,
      logger: { debug: jest.fn(), error: jest.fn() } as any,
      params: { ...baseParams, direction: 'incr' },
    });

    expect(result.phase).toBe(1);
    // Only 'error' should appear (increased), not 'info' (decreased)
    const hasError = result.results.some((r) => r.category['log.level'] === 'error');
    const hasInfo = result.results.some((r) => r.category['log.level'] === 'info');
    expect(hasError).toBe(true);
    expect(hasInfo).toBe(false);
  });

  it('returns empty results when baseline or test is empty', async () => {
    const esClient = {
      esql: {
        query: jest
          .fn()
          .mockRejectedValueOnce(new Error('Unknown command [DIFF_COUNT]'))
          .mockResolvedValueOnce({
            columns: [
              { name: 'log.level', type: 'keyword' },
              { name: 'count', type: 'long' },
              { name: '_partition', type: 'keyword' },
            ],
            values: [['error', 100, 'test']],
          }),
      },
    } as any;

    const result = await diffCountHandler({
      esClient,
      logger: { debug: jest.fn(), error: jest.fn() } as any,
      params: baseParams,
    });

    expect(result.phase).toBe(1);
    expect(result.results).toHaveLength(0);
  });
});
