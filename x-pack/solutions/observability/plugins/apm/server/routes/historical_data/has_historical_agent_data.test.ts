/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { hasHistoricalAgentData } from './has_historical_agent_data';

const makeHits = (value: number) => ({
  columns: [{ name: '@timestamp', type: 'date' }],
  values: value > 0 ? [['2024-01-01T00:00:00.000Z']] : [],
});

// The two-phase probe itself is covered by `lib/helpers/has_apm_data.test.ts`;
// these cases cover the wiring from this endpoint into it.
describe('hasHistoricalAgentData', () => {
  it('returns true from the recent-data phase without running the fallback', async () => {
    const esql = jest.fn().mockResolvedValue(makeHits(1));
    const apmEventClient = { esql } as unknown as APMEventClient;

    expect(await hasHistoricalAgentData(apmEventClient)).toBe(true);
    expect(esql).toHaveBeenCalledTimes(1);
    expect(esql).toHaveBeenCalledWith('has_historical_agent_data', expect.anything());
  });

  it('falls back to the unbounded phase when the recent window is empty', async () => {
    const esql = jest.fn().mockResolvedValueOnce(makeHits(0)).mockResolvedValueOnce(makeHits(1));
    const apmEventClient = { esql } as unknown as APMEventClient;

    expect(await hasHistoricalAgentData(apmEventClient)).toBe(true);
    expect(esql).toHaveBeenCalledTimes(2);
  });

  it('returns false when no data is found anywhere', async () => {
    const esql = jest.fn().mockResolvedValue(makeHits(0));
    const apmEventClient = { esql } as unknown as APMEventClient;

    expect(await hasHistoricalAgentData(apmEventClient)).toBe(false);
    expect(esql).toHaveBeenCalledTimes(2);
  });

  it('propagates errors from the Elasticsearch client', async () => {
    const esql = jest.fn().mockRejectedValue(new Error('ES cluster unhealthy'));
    const apmEventClient = { esql } as unknown as APMEventClient;

    await expect(hasHistoricalAgentData(apmEventClient)).rejects.toThrow('ES cluster unhealthy');
  });
});
