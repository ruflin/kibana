/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  ELASTIC_PROFILER_STACK_TRACE_IDS,
  TRANSACTION_PROFILER_STACK_TRACE_IDS,
} from '../../../common/es_fields/apm';
import { getStacktracesIdsField } from './get_stacktraces_ids_field';

const defaultParams = {
  start: 1000,
  end: 2000,
  environment: 'production',
  serviceName: 'my-service',
  transactionType: 'request',
};

// The transactions that match the query: only the ones with the Elastic profiler field set
function createMockApmEventClient(hits: Array<{ fields?: Record<string, any> }>) {
  return {
    esql: jest.fn().mockResolvedValue({
      columns: [{ name: '@timestamp', type: 'date' }],
      values: hits
        .filter(({ fields }) => fields?.[ELASTIC_PROFILER_STACK_TRACE_IDS]?.length)
        .map(() => ['2024-01-01T00:00:00.000Z']),
    }),
  } as any;
}

describe('getStacktracesIdsField', () => {
  it('returns ELASTIC_PROFILER_STACK_TRACE_IDS when the elastic profiler field exists in the hit', async () => {
    const apmEventClient = createMockApmEventClient([
      {
        fields: {
          [ELASTIC_PROFILER_STACK_TRACE_IDS]: ['trace-id-1', 'trace-id-2'],
        },
      },
    ]);

    const result = await getStacktracesIdsField({ apmEventClient, ...defaultParams });
    expect(result).toBe(ELASTIC_PROFILER_STACK_TRACE_IDS);
  });

  it('returns TRANSACTION_PROFILER_STACK_TRACE_IDS when there are no hits at all', async () => {
    const apmEventClient = createMockApmEventClient([]);

    const result = await getStacktracesIdsField({ apmEventClient, ...defaultParams });
    expect(result).toBe(TRANSACTION_PROFILER_STACK_TRACE_IDS);
  });

  it('returns TRANSACTION_PROFILER_STACK_TRACE_IDS when the hit has no fields', async () => {
    const apmEventClient = createMockApmEventClient([{}]);

    const result = await getStacktracesIdsField({ apmEventClient, ...defaultParams });
    expect(result).toBe(TRANSACTION_PROFILER_STACK_TRACE_IDS);
  });

  describe('when only TRANSACTION_PROFILER_STACK_TRACE_IDS exists in the hit', () => {
    it('returns TRANSACTION_PROFILER_STACK_TRACE_IDS as a fallback', async () => {
      const apmEventClient = createMockApmEventClient([
        {
          fields: {
            [TRANSACTION_PROFILER_STACK_TRACE_IDS]: ['trace-id-1', 'trace-id-2'],
          },
        },
      ]);

      const result = await getStacktracesIdsField({ apmEventClient, ...defaultParams });
      expect(result).toBe(TRANSACTION_PROFILER_STACK_TRACE_IDS);
    });
  });

  describe('when both fields exist in the hit', () => {
    it('returns ELASTIC_PROFILER_STACK_TRACE_IDS (it takes priority)', async () => {
      const apmEventClient = createMockApmEventClient([
        {
          fields: {
            [ELASTIC_PROFILER_STACK_TRACE_IDS]: ['elastic-trace-1'],
            [TRANSACTION_PROFILER_STACK_TRACE_IDS]: ['txn-trace-1'],
          },
        },
      ]);

      const result = await getStacktracesIdsField({ apmEventClient, ...defaultParams });
      expect(result).toBe(ELASTIC_PROFILER_STACK_TRACE_IDS);
    });
  });

  describe('when ELASTIC_PROFILER_STACK_TRACE_IDS exists but is an empty array', () => {
    it('falls back to TRANSACTION_PROFILER_STACK_TRACE_IDS', async () => {
      const apmEventClient = createMockApmEventClient([
        {
          fields: {
            [ELASTIC_PROFILER_STACK_TRACE_IDS]: [],
          },
        },
      ]);

      const result = await getStacktracesIdsField({ apmEventClient, ...defaultParams });
      expect(result).toBe(TRANSACTION_PROFILER_STACK_TRACE_IDS);
    });
  });

  it('asks for one transaction of the service with the elastic profiler field', async () => {
    const apmEventClient = createMockApmEventClient([]);

    await getStacktracesIdsField({
      apmEventClient,
      ...defaultParams,
      transactionName: 'GET /',
    });

    const [operationName, params] = apmEventClient.esql.mock.calls[0];
    expect(operationName).toBe('get_stacktraces_ids_field');
    expect(params.apm).toEqual({ events: ['transaction'] });
    expect(params.query(['myIndex']).toRequest()).toEqual({
      query:
        'SET unmapped_fields = "nullify"; FROM myIndex | WHERE `service.name` == ?service_name | WHERE `transaction.type` == ?transaction_type | WHERE `transaction.name` == ?transaction_name | WHERE `elastic.profiler_stack_trace_ids` IS NOT NULL | KEEP @timestamp | LIMIT 1',
      params: [
        { service_name: 'my-service' },
        { transaction_type: 'request' },
        { transaction_name: 'GET /' },
      ],
    });
  });
});
