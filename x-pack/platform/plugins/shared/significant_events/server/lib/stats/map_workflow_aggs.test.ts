/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { mapWorkflowAggs } from './map_workflow_aggs';

describe('mapWorkflowAggs', () => {
  it('returns empty totals when the index is unavailable', () => {
    expect(mapWorkflowAggs({ response: undefined, available: false })).toEqual({
      available: false,
      totals: {
        workflowRuns: 0,
        workflowRunsByStatus: {},
        tokens: { input: 0, output: 0, cached: 0, total: 0 },
      },
      daily: [],
      workflowTypes: [],
    });
  });

  it('maps day, workflow, status, and token aggregations', () => {
    const mapped = mapWorkflowAggs({
      available: true,
      response: {
        aggregations: {
          by_day: {
            buckets: [
              {
                key_as_string: '2026-07-31T00:00:00.000Z',
                key: Date.parse('2026-07-31T00:00:00.000Z'),
                doc_count: 3,
                by_workflow: {
                  buckets: [
                    { key: 'system-significant-events-discovery', doc_count: 2 },
                    { key: 'system-significant-events-investigation', doc_count: 1 },
                  ],
                },
                by_status: {
                  buckets: [
                    { key: 'completed', doc_count: 2 },
                    { key: 'failed', doc_count: 1 },
                  ],
                },
                input_tokens: { value: 100 },
                output_tokens: { value: 40 },
                cached_tokens: { value: 10 },
              },
            ],
          },
          by_workflow: {
            buckets: [
              {
                key: 'system-significant-events-discovery',
                doc_count: 2,
                by_status: { buckets: [{ key: 'completed', doc_count: 2 }] },
                input_tokens: { value: 80 },
                output_tokens: { value: 30 },
                cached_tokens: { value: 8 },
              },
            ],
          },
          by_status: {
            buckets: [
              { key: 'completed', doc_count: 2 },
              { key: 'failed', doc_count: 1 },
            ],
          },
          input_tokens: { value: 100 },
          output_tokens: { value: 40 },
          cached_tokens: { value: 10 },
        },
      },
    });

    expect(mapped.totals.workflowRuns).toBe(3);
    expect(mapped.totals.workflowRunsByStatus).toEqual({ completed: 2, failed: 1 });
    expect(mapped.totals.tokens).toEqual({ input: 100, output: 40, cached: 10, total: 140 });
    expect(mapped.daily).toHaveLength(1);
    expect(mapped.daily[0].byType['system-significant-events-discovery']).toBe(2);
    expect(mapped.workflowTypes[0]).toEqual({
      workflowId: 'system-significant-events-discovery',
      runs: 2,
      byStatus: { completed: 2 },
      tokens: { input: 80, output: 30, cached: 8, total: 110 },
    });
  });
});
