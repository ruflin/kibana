/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ProfilingESClient } from '@kbn/profiling-data-access-plugin/server';
import { getDailyDataGenerationSize } from './get_daily_data_generation.size';

describe('getDailyDataGenerationSize', () => {
  const GIB = 1024 ** 3;

  it('estimates the daily size from the documents counted per index', async () => {
    const esqlFn = jest.fn().mockResolvedValue({
      columns: [
        { name: 'number_of_documents', type: 'long' },
        { name: '_index', type: 'keyword' },
      ],
      values: [
        [50, 'profiling-events-all'],
        [10, 'profiling-hosts'],
      ],
    });
    const client = { esql: esqlFn } as unknown as ProfilingESClient;

    const result = await getDailyDataGenerationSize({
      client,
      timeFrom: 0,
      timeTo: 2 * 24 * 60 * 60,
      kuery: '',
      allIndicesStats: {
        'profiling-events-all': {
          total: {
            docs: { count: 100, total_size_in_bytes: 0 },
            store: { size_in_bytes: 2 * GIB, reserved_in_bytes: 0 },
          },
        },
        'profiling-hosts': {
          total: {
            docs: { count: 10, total_size_in_bytes: 0 },
            store: { size_in_bytes: 4 * GIB, reserved_in_bytes: 0 },
          },
        },
      },
    });

    // (50 / 100) * 2 GiB + (10 / 10) * 4 GiB, over two days
    expect(result).toEqual({ dailyDataGenerationBytes: (5 * GIB) / 2 });
    expect(esqlFn).toHaveBeenCalledWith('profiling_indices_size', expect.anything(), {
      bool: {
        filter: [{ range: { '@timestamp': { gte: '0', lt: '172800', format: 'epoch_second' } } }],
      },
    });
    expect(esqlFn.mock.calls[0][1].toRequest().query).toBe(
      'FROM profiling-events-*, -profiling-events-*.otel-*, profiling-stacktraces, profiling-hosts, profiling-metrics METADATA _index | STATS number_of_documents = COUNT(*) BY _index | LIMIT 1000'
    );
  });
});
