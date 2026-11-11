/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ProfilingSchema } from '@kbn/profiling-utils';
import type { DownsampledEventsIndex } from './downsampling';
import { loggerMock } from '@kbn/logging-mocks';
import type { ProfilingESClient } from '@kbn/profiling-data-access-plugin/server';
import { findDownsampledIndex, getSampledTraceEventsIndex } from './downsampling';

describe('Using down-sampled indexes', () => {
  const targetSampleSize = 20000;
  const initialExp = 6;

  test('getSampledTraceEventsIndex', () => {
    const tests: Array<{
      sampleCountFromPow6: number;
      expected: DownsampledEventsIndex;
    }> = [
      {
        // stay with the input downsampled index
        sampleCountFromPow6: targetSampleSize,
        expected: { name: 'profiling-events-5pow06', sampleRate: 1 / 5 ** 6 },
      },
      {
        // stay with the input downsampled index
        sampleCountFromPow6: targetSampleSize * 5 - 1,
        expected: { name: 'profiling-events-5pow06', sampleRate: 1 / 5 ** 6 },
      },
      {
        // go down one downsampling step
        sampleCountFromPow6: targetSampleSize * 5,
        expected: { name: 'profiling-events-5pow07', sampleRate: 1 / 5 ** 7 },
      },
      {
        // go up one downsampling step
        sampleCountFromPow6: targetSampleSize - 1,
        expected: { name: 'profiling-events-5pow05', sampleRate: 1 / 5 ** 5 },
      },
      {
        // go to the full events index
        sampleCountFromPow6: 0,
        expected: { name: 'profiling-events-all', sampleRate: 1 },
      },
      {
        // go to the most downsampled index
        sampleCountFromPow6: targetSampleSize * 5 ** 8,
        expected: { name: 'profiling-events-5pow11', sampleRate: 1 / 5 ** 11 },
      },
    ];

    for (const t of tests) {
      expect(
        getSampledTraceEventsIndex(
          ProfilingSchema.ECS,
          targetSampleSize,
          t.sampleCountFromPow6,
          initialExp
        )
      ).toEqual(t.expected);
    }
  });

  test('getSampledTraceEventsIndex with the OTel schema', () => {
    const tests: Array<{
      sampleCountFromPow6: number;
      expected: DownsampledEventsIndex;
    }> = [
      {
        sampleCountFromPow6: targetSampleSize,
        expected: { name: 'profiling-events-5pow06.otel-*', sampleRate: 1 / 5 ** 6 },
      },
      {
        sampleCountFromPow6: targetSampleSize - 1,
        expected: { name: 'profiling-events-5pow05.otel-*', sampleRate: 1 / 5 ** 5 },
      },
      {
        sampleCountFromPow6: 0,
        expected: { name: 'profiling-events-all.otel-*', sampleRate: 1 },
      },
      {
        sampleCountFromPow6: targetSampleSize * 5 ** 8,
        expected: { name: 'profiling-events-5pow11.otel-*', sampleRate: 1 / 5 ** 11 },
      },
    ];

    for (const t of tests) {
      expect(
        getSampledTraceEventsIndex(
          ProfilingSchema.OTEL,
          targetSampleSize,
          t.sampleCountFromPow6,
          initialExp
        )
      ).toEqual(t.expected);
    }
  });
});

describe('findDownsampledIndex', () => {
  const run = async (esqlImpl: jest.Mock) => {
    const client = { esql: esqlImpl } as unknown as ProfilingESClient;
    const filter = { bool: { filter: [{ range: { '@timestamp': { gte: '1' } } }] } };
    const index = await findDownsampledIndex({
      logger: loggerMock.create(),
      client,
      schema: ProfilingSchema.ECS,
      filter,
      sampleSize: 20000,
    });
    return { index, filter };
  };

  it('counts the events of the 5^6 index with ES|QL and picks the index from the count', async () => {
    const esqlFn = jest
      .fn()
      .mockResolvedValue({ columns: [{ name: 'total', type: 'long' }], values: [[20000 * 5]] });

    const { index, filter } = await run(esqlFn);

    expect(esqlFn).toHaveBeenCalledWith('find_downsampled_index', expect.anything(), filter);
    expect(esqlFn.mock.calls[0][1].toRequest().query).toBe(
      'FROM profiling-events-5pow06 | STATS total = COUNT(*)'
    );
    expect(index).toEqual({ name: 'profiling-events-5pow07', sampleRate: 1 / 5 ** 7 });
  });

  it('falls back to the full events index when the count fails', async () => {
    const { index } = await run(jest.fn().mockRejectedValue(new Error('boom')));

    expect(index).toEqual({ name: 'profiling-events-all', sampleRate: 1 });
  });
});
