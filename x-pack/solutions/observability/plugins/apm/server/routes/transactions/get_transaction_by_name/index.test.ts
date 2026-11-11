/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ESQLSearchResponse } from '@kbn/es-types';
import { environmentQuery } from '../../../../common/utils/environment_query';
import { esqlResponse, toEsqlRequest } from '../../../utils/esql_test_helpers';
import { getTransactionByName } from '.';

const requiredFieldsForHit = {
  '@timestamp': ['2025-06-15T14:30:00.000Z'],
  'trace.id': ['trace-abc123'],
  'transaction.id': ['tx-abc123'],
  'transaction.type': ['request'],
  'transaction.name': ['GET /api/orders'],
  'transaction.duration.us': [2500],
  'service.name': ['my-service'],
};

function createMockApmEventClient(esResponse: ESQLSearchResponse) {
  const esql = jest.fn().mockResolvedValue(esResponse);
  return { esql } as any;
}

const noHits = esqlResponse([], []);

const hitWithRequiredFields = esqlResponse(Object.keys(requiredFieldsForHit), [
  Object.values(requiredFieldsForHit).map(([value]) => value),
]);

describe('getTransactionByName', () => {
  it('returns undefined when no hit is found', async () => {
    const apmEventClient = createMockApmEventClient(noHits);

    const result = await getTransactionByName({
      transactionName: 'GET /api/orders',
      serviceName: 'my-service',
      apmEventClient,
      start: 0,
      end: 50000,
    });

    expect(result).toBeUndefined();
  });

  it('returns the transaction when a hit is found', async () => {
    const apmEventClient = createMockApmEventClient(hitWithRequiredFields);

    const result = await getTransactionByName({
      transactionName: 'GET /api/orders',
      serviceName: 'my-service',
      apmEventClient,
      start: 0,
      end: 50000,
    });

    expect(result).toBeDefined();
    expect(result?.transaction.name).toBe('GET /api/orders');
    expect(result?.service.name).toBe('my-service');
  });

  it('reads one transaction by name and service with named parameters', async () => {
    const apmEventClient = createMockApmEventClient(noHits);

    await getTransactionByName({
      transactionName: 'GET /api/orders',
      serviceName: 'my-service',
      apmEventClient,
      start: 0,
      end: 50000,
    });

    const { query, params } = toEsqlRequest(apmEventClient.esql.mock.calls[0][1]);
    expect(query).toContain('WHERE `transaction.name` == ?transactionName');
    expect(query).toContain('WHERE `service.name` == ?serviceName');
    expect(query).toContain('LIMIT 1');
    expect(params).toEqual([{ transactionName: 'GET /api/orders' }, { serviceName: 'my-service' }]);
  });

  describe('environment filtering', () => {
    it('includes an environment filter when environment is provided', async () => {
      const apmEventClient = createMockApmEventClient(noHits);

      await getTransactionByName({
        transactionName: 'GET /api/orders',
        serviceName: 'my-service',
        environment: 'production',
        apmEventClient,
        start: 0,
        end: 50000,
      });

      const calledFilter = apmEventClient.esql.mock.calls[0][1].filter.bool.filter;
      expect(calledFilter).toEqual(expect.arrayContaining(environmentQuery('production')));
    });

    it('does not apply an environment filter when environment is omitted', async () => {
      const apmEventClient = createMockApmEventClient(noHits);

      await getTransactionByName({
        transactionName: 'GET /api/orders',
        serviceName: 'my-service',
        apmEventClient,
        start: 0,
        end: 50000,
      });

      const calledFilter = apmEventClient.esql.mock.calls[0][1].filter.bool.filter;
      const hasEnvFilter = calledFilter.some(
        (f: any) => f?.term?.['service.environment'] !== undefined
      );
      expect(hasEnvFilter).toBe(false);
    });
  });
});
