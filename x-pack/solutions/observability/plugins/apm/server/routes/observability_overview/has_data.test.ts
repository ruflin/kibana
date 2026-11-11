/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { APMIndices } from '@kbn/apm-sources-access-plugin/server';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { getHasData } from './has_data';

const defaultIndices = {
  transaction: 'traces-apm*,apm-*',
  span: 'traces-apm*,apm-*',
  error: 'logs-apm*,apm-*',
  metric: 'metrics-apm*,apm-*',
  onboarding: 'apm-*',
  sourcemap: 'apm-*',
} as APMIndices;

const makeHits = (value: number) => ({
  columns: [{ name: '@timestamp', type: 'date' }],
  values: value > 0 ? [['2024-01-01T00:00:00.000Z']] : [],
});

// The two-phase probe itself is covered by `lib/helpers/has_apm_data.test.ts`;
// these cases cover what this route adds on top of it.
describe('getHasData', () => {
  it('returns true immediately when phase 1 finds data (no phase 2 call)', async () => {
    const esql = jest.fn().mockResolvedValue(makeHits(1));
    const apmEventClient = { esql } as unknown as APMEventClient;

    const result = await getHasData({ indices: defaultIndices, apmEventClient });

    expect(result).toEqual({ hasData: true, indices: defaultIndices });
    expect(esql).toHaveBeenCalledTimes(1);
  });

  it('falls back to phase 2 when phase 1 finds nothing', async () => {
    const esql = jest.fn().mockResolvedValueOnce(makeHits(0)).mockResolvedValueOnce(makeHits(1));
    const apmEventClient = { esql } as unknown as APMEventClient;

    const result = await getHasData({ indices: defaultIndices, apmEventClient });

    expect(result).toEqual({ hasData: true, indices: defaultIndices });
    expect(esql).toHaveBeenCalledTimes(2);
  });

  it('returns false when both phases find nothing', async () => {
    const esql = jest.fn().mockResolvedValue(makeHits(0));
    const apmEventClient = { esql } as unknown as APMEventClient;

    const result = await getHasData({ indices: defaultIndices, apmEventClient });

    expect(result).toEqual({ hasData: false, indices: defaultIndices });
    expect(esql).toHaveBeenCalledTimes(2);
  });

  it('echoes indices back in the response', async () => {
    const esql = jest.fn().mockResolvedValue(makeHits(0));
    const apmEventClient = { esql } as unknown as APMEventClient;

    const result = await getHasData({ indices: defaultIndices, apmEventClient });

    expect(result.indices).toBe(defaultIndices);
  });

  it('returns hasData: false when the client throws', async () => {
    const esql = jest.fn().mockRejectedValue(new Error('ES cluster unhealthy'));
    const apmEventClient = { esql } as unknown as APMEventClient;

    const result = await getHasData({ indices: defaultIndices, apmEventClient });

    expect(result).toEqual({ hasData: false, indices: defaultIndices });
  });
});
