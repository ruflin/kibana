/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { attributeImpactHandler } from './handler';

describe('attributeImpactHandler', () => {
  const baseParams = {
    index: 'metrics-*',
    timeField: '@timestamp',
    start: '2024-01-15T09:00:00Z',
    end: '2024-01-15T11:00:00Z',
    metricField: 'http.response.latency',
    testExpression: '@timestamp >= "2024-01-15T10:00:00Z"',
    covariates: ['service.name'],
    limit: 10,
  };

  it('falls back to phase 1 and computes shift-share decomposition', async () => {
    const esClient = {
      esql: {
        query: jest
          .fn()
          .mockRejectedValueOnce(new Error('Unknown command [IMPACT]'))
          .mockResolvedValueOnce({
            columns: [
              { name: 'service.name', type: 'keyword' },
              { name: 'avg_val', type: 'double' },
              { name: 'cnt', type: 'long' },
              { name: '_partition', type: 'keyword' },
            ],
            values: [
              // Baseline: svc-a has 50% traffic at latency 100, svc-b has 50% at latency 200
              // Overall baseline mean = 150
              ['svc-a', 100, 50, 'baseline'],
              ['svc-b', 200, 50, 'baseline'],
              // Test: svc-a has 20% traffic at latency 100, svc-b has 80% at latency 300
              // svc-b both increased in proportion AND got slower
              ['svc-a', 100, 20, 'test'],
              ['svc-b', 300, 80, 'test'],
            ],
          }),
      },
    } as any;

    const result = await attributeImpactHandler({
      esClient,
      logger: { debug: jest.fn(), error: jest.fn() } as any,
      params: baseParams,
    });

    expect(result.phase).toBe(1);
    expect(result.results.length).toBe(2);

    const svcB = result.results.find((r) => r.value === 'svc-b');
    expect(svcB).toBeDefined();
    // svc-b: mix impact = (0.8 - 0.5) * (200 - 150) = 0.3 * 50 = 15
    expect(svcB!.mixImpact).toBeCloseTo(15, 5);
    // svc-b: shift impact = 0.8 * (300 - 200) = 80
    expect(svcB!.shiftImpact).toBeCloseTo(80, 5);
    expect(svcB!.totalScore).toBeCloseTo(95, 5);
  });

  it('handles multiple covariates', async () => {
    const esClient = {
      esql: {
        query: jest.fn().mockImplementation(({ query }: { query: string }) => {
          if (query.includes('IMPACT')) {
            return Promise.reject(new Error('Unknown command'));
          }
          // Return different results for each covariate
          return Promise.resolve({
            columns: [
              {
                name: query.includes('service.name') ? 'service.name' : 'host.name',
                type: 'keyword',
              },
              { name: 'avg_val', type: 'double' },
              { name: 'cnt', type: 'long' },
              { name: '_partition', type: 'keyword' },
            ],
            values: [
              ['val-a', 100, 50, 'baseline'],
              ['val-b', 200, 50, 'baseline'],
              ['val-a', 150, 50, 'test'],
              ['val-b', 250, 50, 'test'],
            ],
          });
        }),
      },
    } as any;

    const result = await attributeImpactHandler({
      esClient,
      logger: { debug: jest.fn(), error: jest.fn() } as any,
      params: { ...baseParams, covariates: ['service.name', 'host.name'] },
    });

    expect(result.phase).toBe(1);
    // Should have results from both covariates
    expect(result.results.length).toBeGreaterThan(0);
  });

  it('returns empty results when baseline is empty', async () => {
    const esClient = {
      esql: {
        query: jest
          .fn()
          .mockRejectedValueOnce(new Error('Unknown command'))
          .mockResolvedValueOnce({
            columns: [
              { name: 'service.name', type: 'keyword' },
              { name: 'avg_val', type: 'double' },
              { name: 'cnt', type: 'long' },
              { name: '_partition', type: 'keyword' },
            ],
            values: [['svc-a', 100, 50, 'test']],
          }),
      },
    } as any;

    const result = await attributeImpactHandler({
      esClient,
      logger: { debug: jest.fn(), error: jest.fn() } as any,
      params: baseParams,
    });

    expect(result.phase).toBe(1);
    expect(result.results).toHaveLength(0);
  });
});
