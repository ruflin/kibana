/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import { countPendingAlerts } from './backfill_client';

describe('countPendingAlerts', () => {
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  const logger = loggingSystemMock.createLogger();
  const query = { bool: { must_not: { exists: { field: 'kibana.alert.entity_id' } } } };
  const run = () =>
    countPendingAlerts({
      esClient,
      logger,
      alertsIndex: '.alerts-security.alerts-default',
      query,
      signal: new AbortController().signal,
    });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('counts the alerts the query matches, sending the query as the request filter', async () => {
    esClient.esql.query.mockResolvedValue({
      columns: [{ name: 'total', type: 'long' }],
      values: [[42]],
    } as never);

    await expect(run()).resolves.toBe(42);
    expect(esClient.esql.query).toHaveBeenCalledWith(
      {
        query: 'FROM .alerts-security.alerts-default | STATS total = COUNT(*)',
        params: [],
        filter: query,
      },
      { signal: expect.any(AbortSignal) }
    );
  });

  it('counts none when the alerts index does not exist', async () => {
    const { errors } = jest.requireActual('@elastic/elasticsearch');
    esClient.esql.query.mockRejectedValue(
      new errors.ResponseError({
        statusCode: 400,
        body: { error: { type: 'verification_exception', reason: 'Unknown index [x]' } },
        headers: {},
        warnings: [],
        meta: {} as never,
      })
    );

    await expect(run()).resolves.toBe(0);
  });
});
