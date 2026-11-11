/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { PROFILING_EVENTS_INDEX_BY_SCHEMA, ProfilingSchema } from '@kbn/profiling-utils';
import type { ProfilingESClient } from '../../../utils/profiling_es_client';
import { hasOtelProfilingData } from './has_otel_profiling_data';

describe('hasOtelProfilingData', () => {
  function createClient() {
    const esqlFn = jest.fn();
    const client = { esql: esqlFn } as unknown as ProfilingESClient;
    return { client, esqlFn };
  }

  const foundResponse = {
    columns: [{ name: '@timestamp', type: 'date' }],
    values: [['2026-01-01']],
  };
  const emptyResponse = { columns: [], values: [] };

  it('queries one document of the OTel profiling events data streams', async () => {
    const { client, esqlFn } = createClient();
    esqlFn.mockResolvedValue(emptyResponse);

    await hasOtelProfilingData({ client });

    expect(esqlFn).toHaveBeenCalledWith('has_any_otel_profiling_data', expect.anything());
    expect(esqlFn.mock.calls[0][1].toRequest().query).toBe(
      `FROM ${PROFILING_EVENTS_INDEX_BY_SCHEMA[ProfilingSchema.OTEL]} | LIMIT 1`
    );
  });

  it('returns true when there is a row', async () => {
    const { client, esqlFn } = createClient();
    esqlFn.mockResolvedValue(foundResponse);

    await expect(hasOtelProfilingData({ client })).resolves.toBe(true);
  });

  it('returns false when there is no row', async () => {
    const { client, esqlFn } = createClient();
    esqlFn.mockResolvedValue(emptyResponse);

    await expect(hasOtelProfilingData({ client })).resolves.toBe(false);
  });

  it('rethrows query errors', async () => {
    const { client, esqlFn } = createClient();
    const error = new Error('security_exception');
    esqlFn.mockRejectedValue(error);

    await expect(hasOtelProfilingData({ client })).rejects.toBe(error);
  });
});
