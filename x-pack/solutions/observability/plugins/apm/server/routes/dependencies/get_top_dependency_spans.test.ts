/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { omit } from 'lodash';
import { loggingSystemMock } from '@kbn/core/server/mocks';
import { getTopDependencySpans } from './get_top_dependency_spans';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import type { Environment } from '../../../common/environment_rt';
import { esqlResponseFromRows, toEsqlRequest } from '../../utils/esql_test_helpers';

type Hit = { _id: string; _index: string; fields: Record<string, unknown[]> };

function hitToRow({ _id, _index, fields }: Hit) {
  return {
    _id,
    _index,
    ...Object.fromEntries(Object.entries(fields).map(([name, values]) => [name, values[0]])),
  };
}

function createApmEventClientMock(spanHits: Hit[], transactionHits: Hit[] = []): APMEventClient {
  return {
    esql: jest
      .fn()
      .mockResolvedValueOnce(esqlResponseFromRows(spanHits.map(hitToRow)))
      .mockResolvedValueOnce(esqlResponseFromRows(transactionHits.map(hitToRow))),
  } as unknown as APMEventClient;
}

function validSpanHit(overrides: Record<string, unknown[]> = {}): Hit {
  return {
    _id: 'span-1',
    _index: 'apm-span',
    fields: {
      'span.id': ['span-1'],
      'trace.id': ['trace-1'],
      'span.name': ['SELECT'],
      'service.name': ['my-service'],
      'agent.name': ['nodejs'],
      'span.duration.us': [1000],
      'event.outcome': ['success'],
      '@timestamp': ['2023-01-01T00:00:00.000Z'],
      ...overrides,
    },
  };
}

describe('getTopDependencySpans', () => {
  const baseParams = {
    dependencyName: 'postgres',
    spanName: 'SELECT',
    start: 0,
    end: 1,
    environment: 'ENVIRONMENT_ALL' as Environment,
    kuery: '',
  };

  // A single OTel/partial span missing a required field used to make the whole mapping throw,
  // turning the request into a 500. The malformed hit is now skipped and the valid ones returned.
  it('skips malformed span hits instead of failing the whole request', async () => {
    const malformedSpanHit = {
      _id: 'span-2',
      _index: 'logs-generic.otel-default',
      fields: {
        'span.id': ['span-2'],
        'trace.id': ['trace-2'],
        'span.name': ['SELECT'],
        'service.name': ['my-service'],
        'agent.name': ['otlp'],
        // `span.duration.us` is missing on this OTel-native document.
        '@timestamp': ['2023-01-01T00:00:00.000Z'],
      },
    };

    const apmEventClient = createApmEventClientMock([malformedSpanHit, validSpanHit()]);
    const logger = loggingSystemMock.createLogger();

    const spans = await getTopDependencySpans({
      apmEventClient,
      logger,
      ...baseParams,
    });

    expect(spans).toHaveLength(1);
    expect(spans[0].spanId).toBe('span-1');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('span-2'));
  });

  it('keeps spans without `event.outcome` and reports an unknown outcome', async () => {
    const fields = omit(validSpanHit().fields, 'event.outcome');
    const apmEventClient = createApmEventClientMock([{ _id: 'span-4', _index: 'x', fields }]);
    const logger = loggingSystemMock.createLogger();

    const spans = await getTopDependencySpans({ apmEventClient, logger, ...baseParams });

    expect(spans).toHaveLength(1);
    expect(spans[0].outcome).toBe('unknown');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  describe('transaction hits', () => {
    function validTransactionHit(overrides: Record<string, unknown[]> = {}): Hit {
      return {
        _id: 'tx-1',
        _index: 'apm-transaction',
        fields: {
          'trace.id': ['trace-1'],
          'transaction.id': ['tx-1'],
          'transaction.type': ['request'],
          'transaction.name': ['GET /api'],
          ...overrides,
        },
      };
    }

    it('enriches spans with metadata from the matching transaction', async () => {
      const apmEventClient = createApmEventClientMock([validSpanHit()], [validTransactionHit()]);
      const logger = loggingSystemMock.createLogger();

      const spans = await getTopDependencySpans({ apmEventClient, logger, ...baseParams });

      expect(spans).toHaveLength(1);
      expect(spans[0]).toEqual(
        expect.objectContaining({
          transactionId: 'tx-1',
          transactionType: 'request',
          transactionName: 'GET /api',
        })
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('skips malformed transaction hits and keeps valid transaction metadata', async () => {
      const malformedTransactionHit = {
        _id: 'tx-2',
        _index: 'logs-generic.otel-default',
        fields: {
          'trace.id': ['trace-2'],
          'transaction.id': ['tx-2'],
          'transaction.type': ['request'],
          // `transaction.name` is missing on this partial document.
        },
      };

      const apmEventClient = createApmEventClientMock(
        [validSpanHit(), validSpanHit({ 'span.id': ['span-2'], 'trace.id': ['trace-2'] })],
        [malformedTransactionHit, validTransactionHit()]
      );
      const logger = loggingSystemMock.createLogger();

      const spans = await getTopDependencySpans({ apmEventClient, logger, ...baseParams });

      expect(spans).toHaveLength(2);
      expect(spans.find((span) => span.traceId === 'trace-1')?.transactionId).toBe('tx-1');

      const spanWithMalformedTransaction = spans.find((span) => span.traceId === 'trace-2');
      expect(spanWithMalformedTransaction).toBeDefined();
      expect(spanWithMalformedTransaction?.transactionId).toBeUndefined();
      expect(spanWithMalformedTransaction?.transactionName).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('tx-2'));
    });
  });

  it('returns all spans when they are all well-formed', async () => {
    const apmEventClient = createApmEventClientMock([
      validSpanHit(),
      validSpanHit({ 'span.id': ['span-3'], 'trace.id': ['trace-3'] }),
    ]);
    const logger = loggingSystemMock.createLogger();

    const spans = await getTopDependencySpans({
      apmEventClient,
      logger,
      ...baseParams,
    });

    expect(spans).toHaveLength(2);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('queries the spans of the dependency and then the transactions of their traces', async () => {
    const apmEventClient = createApmEventClientMock([validSpanHit()]);

    await getTopDependencySpans({
      apmEventClient,
      logger: loggingSystemMock.createLogger(),
      ...baseParams,
      sampleRangeFrom: 10,
      sampleRangeTo: 20,
    });

    const [spanCall, transactionCall] = (apmEventClient.esql as jest.Mock).mock.calls;
    expect(toEsqlRequest(spanCall[1])).toMatchObject({
      query: expect.stringContaining(
        'WHERE `span.destination.service.resource` == ?dependencyName | WHERE `span.name` == ?spanName | WHERE `span.duration.us` >= ?sampleRangeFrom | WHERE `span.duration.us` <= ?sampleRangeTo | KEEP _id, _index'
      ),
      params: expect.arrayContaining([
        { dependencyName: 'postgres' },
        { spanName: 'SELECT' },
        { sampleRangeFrom: 10 },
        { sampleRangeTo: 20 },
      ]),
    });
    expect(toEsqlRequest(transactionCall[1])).toMatchObject({
      query: expect.stringContaining(
        'WHERE (`trace.id` IN (?traceIds)) AND `transaction.id` IS NOT NULL | SORT @timestamp DESC NULLS LAST'
      ),
      params: [{ traceIds: ['trace-1'] }],
    });
  });
});
