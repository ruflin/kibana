/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';

import { countGateScopeAlerts, GATE_SCOPE_MIN_LOOKBACK } from '.';

describe('countGateScopeAlerts', () => {
  const alertsIndexPattern = '.alerts-security.alerts-default';
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  const esqlQuery = esClient.esql.query as unknown as jest.Mock;

  const getRequest = (): {
    query: string;
    params: Array<Record<string, string>>;
    [k: string]: unknown;
  } => esqlQuery.mock.calls[0][0];
  const getParams = (): Record<string, string> => Object.assign({}, ...getRequest().params);

  beforeEach(() => {
    jest.clearAllMocks();

    esqlQuery.mockResolvedValue({ columns: [{ name: 'total', type: 'long' }], values: [[7]] });
  });

  it('returns the count from Elasticsearch', async () => {
    await expect(countGateScopeAlerts({ alertsIndexPattern, esClient })).resolves.toBe(7);
  });

  it('counts the alerts index', async () => {
    await countGateScopeAlerts({ alertsIndexPattern, esClient });

    expect(getRequest().query).toMatch(/^FROM \.alerts-security\.alerts-default \| WHERE /);
  });

  it('treats a missing alerts index as zero alerts instead of an error', async () => {
    esqlQuery.mockRejectedValue(
      Object.assign(new Error('verification_exception'), {
        statusCode: 400,
        body: {
          error: { type: 'verification_exception', reason: 'Unknown index [.alerts-security*]' },
        },
      })
    );

    await expect(countGateScopeAlerts({ alertsIndexPattern, esClient })).resolves.toBe(0);
  });

  it('counts only open and acknowledged alerts', async () => {
    await countGateScopeAlerts({ alertsIndexPattern, esClient });

    expect(getRequest().query).toContain(
      'kibana.alert.workflow_status IN ("open", "acknowledged")'
    );
  });

  it('excludes building block alerts', async () => {
    await countGateScopeAlerts({ alertsIndexPattern, esClient });

    expect(getRequest().query).toContain('kibana.alert.building_block_type IS NULL');
  });

  it('counts alerts in the run time range or the minimum lookback', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-01-10T12:00:00.000Z'));
    try {
      await countGateScopeAlerts({ alertsIndexPattern, end: 'now-1d', esClient, start: 'now-2d' });
    } finally {
      jest.useRealTimers();
    }

    expect(getRequest().query).toContain(
      '(@timestamp >= TO_DATETIME(?rangeStart) AND @timestamp <= TO_DATETIME(?rangeEnd) OR @timestamp >= TO_DATETIME(?minimumStart))'
    );
    expect(getParams()).toEqual({
      rangeStart: '2025-01-08T12:00:00.000Z',
      rangeEnd: '2025-01-09T12:00:00.000Z',
      minimumStart: '2025-01-03T12:00:00.000Z',
    });
  });

  it('uses the last 7 days as the minimum lookback', () => {
    expect(GATE_SCOPE_MIN_LOOKBACK).toBe('now-7d');
  });

  it('defaults the run time range to the last 24 hours', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-01-10T12:00:00.000Z'));
    try {
      await countGateScopeAlerts({ alertsIndexPattern, esClient });
    } finally {
      jest.useRealTimers();
    }

    expect(getParams()).toEqual(
      expect.objectContaining({
        rangeStart: '2025-01-09T12:00:00.000Z',
        rangeEnd: '2025-01-10T12:00:00.000Z',
      })
    );
  });

  it('does not allow partial results', async () => {
    await countGateScopeAlerts({ alertsIndexPattern, esClient });

    expect(getRequest().allow_partial_results).toBe(false);
  });

  it('throws when a shard fails, so a partial count is not mistaken for zero', async () => {
    esqlQuery.mockResolvedValue({
      columns: [{ name: 'total', type: 'long' }],
      is_partial: true,
      values: [[0]],
    });

    await expect(countGateScopeAlerts({ alertsIndexPattern, esClient })).rejects.toThrow(
      'one or more shards failed'
    );
  });

  it('propagates Elasticsearch errors to the caller', async () => {
    esqlQuery.mockRejectedValue(new Error('boom'));

    await expect(countGateScopeAlerts({ alertsIndexPattern, esClient })).rejects.toThrow('boom');
  });
});
