/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ESQLSearchResponse } from '@kbn/es-types';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlResponse, toEsqlRequest } from '../../utils/esql_test_helpers';
import { MAX_CONNECTION_IDS } from './connection_constants';
import { getConnectionFailedCalls } from './get_connection_failed_calls';

// withApmSpan is just a tracing wrapper: invoke the callback directly in tests.
jest.mock('../../utils/with_apm_span', () => ({
  withApmSpan: (_name: string, fn: () => Promise<unknown>) => fn(),
}));

const START = 1_700_000_000_000;
const END = 1_700_000_900_000;

interface FailedSpanFixture {
  spanId: string;
  traceId?: string;
  httpStatus?: number;
  grpcCode?: number;
}

type EsqlParams = Parameters<APMEventClient['esql']>[1];

/**
 * An `esql` mock that answers by operation name. A response is used once per call, in order, and
 * an operation without a response gets an empty result.
 */
function setup() {
  const responses: Record<string, ESQLSearchResponse[]> = {};
  const esql = jest.fn(async (operationName: string, _params: EsqlParams) => {
    return responses[operationName]?.shift() ?? esqlResponse([], []);
  });
  const respond = (operationName: string, ...operationResponses: ESQLSearchResponse[]) => {
    responses[operationName] = operationResponses;
  };
  const callsOf = (operationName: string) =>
    esql.mock.calls
      .filter(([name]) => name === operationName)
      .map(([, params]) => toEsqlRequest(params));
  const options = (
    overrides: Partial<Parameters<typeof getConnectionFailedCalls>[0]> = {}
  ): Parameters<typeof getConnectionFailedCalls>[0] => ({
    apmEventClient: { esql } as unknown as APMEventClient,
    sourceServiceName: 'serviceA',
    dependencies: ['redis'],
    environment: 'production',
    start: START,
    end: END,
    ...overrides,
  });
  return { esql, respond, callsOf, options };
}

type Setup = ReturnType<typeof setup>;

/** The failed exit spans and the totals, which every call reads first. */
function respondWithSpans(
  { respond }: Setup,
  spans: FailedSpanFixture[],
  { totalFailed = spans.length, totalCalls }: { totalFailed?: number; totalCalls: number }
) {
  respond(
    'get_connection_failed_calls_failed_spans',
    esqlResponse(
      [
        'span.id',
        'trace.id',
        'http.response.status_code',
        'rpc.grpc.status_code',
        'attributes.rpc.grpc.status_code',
      ],
      spans.map(({ spanId, traceId, httpStatus, grpcCode }) => [
        spanId,
        traceId ?? null,
        httpStatus ?? null,
        null,
        grpcCode ?? null,
      ])
    )
  );
  respond(
    'get_connection_failed_calls_total_calls',
    esqlResponse(['total_calls', 'total_failed'], [[totalCalls, totalFailed]])
  );
}

function entryTransactionsResponse(
  transactions: Array<{ parentId: string; id: string; outcome: 'success' | 'failure' }>
) {
  return esqlResponse(
    ['parent.id', 'transaction.id', 'event.outcome'],
    transactions.map(({ parentId, id, outcome }) => [parentId, id, outcome])
  );
}

/** The top group, then its sample document: what `getTopError` reads. */
function respondWithTopError(
  { respond }: Setup,
  operationName: string,
  error?: { message: string; groupId: string }
) {
  respond(
    operationName,
    esqlResponse(['doc_count', 'error.grouping_key'], error ? [[1, error.groupId]] : [])
  );
  if (error) {
    respond(
      `${operationName}_sample`,
      esqlResponse(
        ['error.log.message', 'error.exception.message', 'error.exception.type'],
        [[null, error.message, null]]
      )
    );
  }
}

describe('getConnectionFailedCalls', () => {
  describe('queries', () => {
    it('reads the newest failed exit spans of the source to the resources, and counts all calls', async () => {
      const ctx = setup();
      respondWithSpans(ctx, [], { totalCalls: 40 });

      await getConnectionFailedCalls(ctx.options({ dependencies: ['redis', 'postgresql'] }));

      const [failedCall] = ctx.callsOf('get_connection_failed_calls_failed_spans');
      expect(failedCall.apm).toEqual({ events: ['span'] });
      expect(failedCall.query).toContain('WHERE `service.name` == ?sourceServiceName');
      expect(failedCall.query).toContain(
        'WHERE `span.destination.service.resource` IN (?dependencies)'
      );
      expect(failedCall.query).toContain('WHERE `event.outcome` == ?outcome');
      expect(failedCall.query).toContain('SORT @timestamp DESC NULLS LAST');
      expect(failedCall.query).toContain(`LIMIT ${MAX_CONNECTION_IDS}`);
      expect(failedCall.params).toEqual(
        expect.arrayContaining([
          { sourceServiceName: 'serviceA' },
          { dependencies: ['redis', 'postgresql'] },
          { outcome: 'failure' },
        ])
      );

      const [totalCall] = ctx.callsOf('get_connection_failed_calls_total_calls');
      expect(totalCall.apm).toEqual({ events: ['span'] });
      expect(totalCall.query).toContain('total_calls = COUNT(*)');
      expect(totalCall.query).toContain(
        'total_failed = COUNT(*) WHERE `event.outcome` == ?failure'
      );
      expect(totalCall.query).not.toContain('SORT');
    });

    it('returns the exact totals and no bucket when nothing failed', async () => {
      const ctx = setup();
      respondWithSpans(ctx, [], { totalCalls: 40 });

      const result = await getConnectionFailedCalls(ctx.options());

      expect(result).toEqual({ buckets: [], totalFailed: 0, totalCalls: 40, isSampled: false });
      expect(ctx.esql).toHaveBeenCalledTimes(2);
    });
  });

  describe('service → dependency', () => {
    it('returns one dependency bucket with the top error document', async () => {
      const ctx = setup();
      respondWithSpans(
        ctx,
        [
          { spanId: 'span-1', traceId: 'trace-1' },
          { spanId: 'span-2', traceId: 'trace-2' },
        ],
        { totalCalls: 10 }
      );
      respondWithTopError(ctx, 'get_connection_failed_calls_top_error_of_spans', {
        message: 'Connection refused',
        groupId: 'g1',
      });

      const result = await getConnectionFailedCalls(ctx.options());

      expect(result).toEqual({
        buckets: [
          {
            type: 'dependency',
            count: 2,
            sampleTraceId: 'trace-1',
            topError: 'Connection refused',
            topErrorGroupId: 'g1',
          },
        ],
        totalFailed: 2,
        totalCalls: 10,
        isSampled: false,
      });
    });

    it('looks for the error documents of the spans by parent.id or span.id', async () => {
      const ctx = setup();
      respondWithSpans(ctx, [{ spanId: 'span-1' }, { spanId: 'span-2' }], { totalCalls: 10 });
      respondWithTopError(ctx, 'get_connection_failed_calls_top_error_of_spans');

      await getConnectionFailedCalls(ctx.options());

      const [errorQuery] = ctx.callsOf('get_connection_failed_calls_top_error_of_spans');
      expect(errorQuery.apm).toEqual({ events: ['error'] });
      expect(errorQuery.query).toContain('WHERE `service.name` == ?serviceName');
      expect(errorQuery.query).toContain(
        'WHERE (`parent.id` IN (?parentIds)) OR (`span.id` IN (?spanIds))'
      );
      expect(errorQuery.params).toEqual(
        expect.arrayContaining([
          { serviceName: 'serviceA' },
          { parentIds: ['span-1', 'span-2'] },
          { spanIds: ['span-1', 'span-2'] },
        ])
      );
    });

    it('falls back to the most frequent HTTP status when there is no error document', async () => {
      const ctx = setup();
      respondWithSpans(
        ctx,
        [
          { spanId: 'span-1', httpStatus: 503 },
          { spanId: 'span-2', httpStatus: 500 },
          { spanId: 'span-3', httpStatus: 503 },
        ],
        { totalCalls: 10 }
      );
      respondWithTopError(ctx, 'get_connection_failed_calls_top_error_of_spans');

      const { buckets } = await getConnectionFailedCalls(ctx.options());

      expect(buckets[0]).toMatchObject({ topError: 'HTTP 503', topErrorGroupId: null });
    });

    it('falls back to the gRPC status name when there is no HTTP status', async () => {
      const ctx = setup();
      respondWithSpans(ctx, [{ spanId: 'span-1', grpcCode: 14 }], { totalCalls: 10 });
      respondWithTopError(ctx, 'get_connection_failed_calls_top_error_of_spans');

      const { buckets } = await getConnectionFailedCalls(ctx.options());

      expect(buckets[0]).toMatchObject({ topError: 'gRPC UNAVAILABLE', topErrorGroupId: null });
    });

    it.each([
      [6, 'ALREADY_EXISTS'],
      [9, 'FAILED_PRECONDITION'],
      [15, 'DATA_LOSS'],
    ])('names the gRPC status %i', async (grpcCode, name) => {
      const ctx = setup();
      respondWithSpans(ctx, [{ spanId: 'span-1', grpcCode }], { totalCalls: 10 });
      respondWithTopError(ctx, 'get_connection_failed_calls_top_error_of_spans');

      const { buckets } = await getConnectionFailedCalls(ctx.options());

      expect(buckets[0]).toMatchObject({ topError: `gRPC ${name}` });
    });

    it('has no top error when nothing explains the failure', async () => {
      const ctx = setup();
      respondWithSpans(ctx, [{ spanId: 'span-1' }], { totalCalls: 10 });
      respondWithTopError(ctx, 'get_connection_failed_calls_top_error_of_spans');

      const { buckets } = await getConnectionFailedCalls(ctx.options());

      expect(buckets[0]).toMatchObject({ topError: null, topErrorGroupId: null });
    });
  });

  describe('sampling', () => {
    it('reports exact totals and flags the result when more spans failed than were classified', async () => {
      const ctx = setup();
      respondWithSpans(ctx, [{ spanId: 'span-1' }], { totalFailed: 5_000, totalCalls: 20_000 });
      respondWithTopError(ctx, 'get_connection_failed_calls_top_error_of_spans');

      const result = await getConnectionFailedCalls(ctx.options());

      expect(result).toMatchObject({ totalFailed: 5_000, totalCalls: 20_000, isSampled: true });
      expect(result.buckets[0].count).toBe(1);
    });
  });

  describe('service → service', () => {
    const failedSpans = [
      { spanId: 'caller-span', traceId: 'trace-caller', httpStatus: 504 },
      { spanId: 'server-span', traceId: 'trace-server' },
      { spanId: 'client-span', traceId: 'trace-client', httpStatus: 400 },
    ];

    function mockServiceToService(ctx: Setup) {
      respondWithSpans(ctx, failedSpans, { totalCalls: 30 });
      // entry transactions of the target: the caller span never reached it
      ctx.respond(
        'get_connection_failed_calls_target_transactions',
        entryTransactionsResponse([
          { parentId: 'server-span', id: 'tx-server', outcome: 'failure' },
          { parentId: 'client-span', id: 'tx-client', outcome: 'success' },
        ])
      );
      // top errors: caller bucket (spans) and server bucket (target transactions)
      respondWithTopError(ctx, 'get_connection_failed_calls_top_error_of_spans');
      respondWithTopError(ctx, 'get_connection_failed_calls_top_error_of_transactions', {
        message: 'NullPointerException',
        groupId: 'g2',
      });
    }

    it('classifies the failed spans by what happened in the target service', async () => {
      const ctx = setup();
      mockServiceToService(ctx);

      const result = await getConnectionFailedCalls(ctx.options({ targetServiceName: 'serviceB' }));

      expect(result.buckets).toEqual([
        {
          type: 'caller',
          count: 1,
          sampleTraceId: 'trace-caller',
          topError: 'HTTP 504',
          topErrorGroupId: null,
        },
        {
          type: 'server',
          count: 1,
          sampleTraceId: 'trace-server',
          topError: 'NullPointerException',
          topErrorGroupId: 'g2',
        },
        {
          type: 'client',
          count: 1,
          sampleTraceId: 'trace-client',
          topError: 'HTTP 400',
          topErrorGroupId: null,
        },
      ]);
      expect(result).toMatchObject({ totalFailed: 3, totalCalls: 30, isSampled: false });
    });

    it('finds the entry transactions of the target by the failed span ids, in any environment', async () => {
      const ctx = setup();
      mockServiceToService(ctx);

      await getConnectionFailedCalls(ctx.options({ targetServiceName: 'serviceB' }));

      const [entryTransactionsQuery] = ctx.callsOf(
        'get_connection_failed_calls_target_transactions'
      );
      expect(entryTransactionsQuery.apm).toEqual({ events: ['transaction'] });
      expect(entryTransactionsQuery.query).toContain('WHERE `service.name` == ?targetServiceName');
      expect(entryTransactionsQuery.query).toContain('WHERE `parent.id` IN (?failedSpanIds)');
      expect(entryTransactionsQuery.params).toEqual(
        expect.arrayContaining([
          { targetServiceName: 'serviceB' },
          { failedSpanIds: ['caller-span', 'server-span', 'client-span'] },
        ])
      );
      expect(JSON.stringify(entryTransactionsQuery.filter)).not.toContain('service.environment');
    });

    it('looks for the server errors in the failed entry transactions of the target', async () => {
      const ctx = setup();
      mockServiceToService(ctx);

      await getConnectionFailedCalls(ctx.options({ targetServiceName: 'serviceB' }));

      const [serverErrorQuery] = ctx.callsOf(
        'get_connection_failed_calls_top_error_of_transactions'
      );
      expect(serverErrorQuery.query).toContain('WHERE `transaction.id` IN (?transactionIds)');
      expect(serverErrorQuery.params).toEqual(
        expect.arrayContaining([{ serviceName: 'serviceB' }, { transactionIds: ['tx-server'] }])
      );
    });
  });
});
