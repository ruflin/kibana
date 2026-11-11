/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ProfilingSetupOptions } from './setup';
import { hasProfilingData } from './has_profiling_data';

describe('hasProfilingData', () => {
  function createSetupOptions() {
    const esqlFn = jest.fn();

    const setupOptions = {
      client: {} as ProfilingSetupOptions['client'],
      clientWithProfilingAuth: { esql: esqlFn },
      logger: {} as ProfilingSetupOptions['logger'],
      soClient: {} as ProfilingSetupOptions['soClient'],
      spaceId: 'test-space',
    } as unknown as ProfilingSetupOptions;

    return { setupOptions, esqlFn };
  }

  it('searches the Universal Profiling indices, excluding the OTel ones', async () => {
    const { setupOptions, esqlFn } = createSetupOptions();
    esqlFn.mockResolvedValue({ columns: [], values: [] });

    await hasProfilingData(setupOptions);

    expect(esqlFn).toHaveBeenCalledWith('has_any_profiling_data', expect.anything());
    expect(esqlFn.mock.calls[0][1].toRequest().query).toBe('FROM profiling*, -*.otel-* | LIMIT 1');
  });

  it('returns data available when there are hits', async () => {
    const { setupOptions, esqlFn } = createSetupOptions();
    esqlFn.mockResolvedValue({
      columns: [{ name: '@timestamp', type: 'date' }],
      values: [['2026-01-01']],
    });

    await expect(hasProfilingData(setupOptions)).resolves.toEqual({
      data: { available: true },
    });
  });

  it('returns data not available when there are no hits', async () => {
    const { setupOptions, esqlFn } = createSetupOptions();
    esqlFn.mockResolvedValue({ columns: [], values: [] });

    await expect(hasProfilingData(setupOptions)).resolves.toEqual({
      data: { available: false },
    });
  });

  it('returns data not available when the search fails', async () => {
    const { setupOptions, esqlFn } = createSetupOptions();
    esqlFn.mockRejectedValue(new Error('search failed'));

    await expect(hasProfilingData(setupOptions)).resolves.toEqual({
      data: { available: false },
    });
  });
});
