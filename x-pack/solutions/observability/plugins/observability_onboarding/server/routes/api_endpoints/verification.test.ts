/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isRight } from 'fp-ts/Either';
import { errors } from '@elastic/elasticsearch';
import type { TransportResult } from '@elastic/elasticsearch';
import { INGEST_RECEIPTS_DATA_STREAM } from '../../../common/ingest_receipts';
import { IS_INGEST_RECEIPTS_ENABLED } from '../../../common/feature_flags';
import { apiEndpointsRouteRepository } from './route';

const verificationEndpoint =
  'GET /internal/observability_onboarding/api_endpoints/verification' as const;

const createEsResponseError = (statusCode: number, body: Record<string, unknown>) =>
  new errors.ResponseError({
    statusCode,
    body,
    headers: {},
    warnings: [],
    meta: {} as TransportResult['meta'],
  });

describe('verification query codec', () => {
  const { params } = apiEndpointsRouteRepository[verificationEndpoint];

  it('accepts an API key id', () => {
    expect(isRight(params.decode({ query: { apiKeyId: 'key-id' } }))).toBe(true);
  });

  it('requires the API key id', () => {
    expect(isRight(params.decode({ query: {} }))).toBe(false);
  });

  // An empty id makes Elasticsearch list every key the caller owns, so the ownership check
  // would pass for anybody holding a key.
  it('rejects an empty API key id', () => {
    expect(isRight(params.decode({ query: { apiKeyId: '' } }))).toBe(false);
  });

  it('rejects an API key id longer than 64 characters', () => {
    expect(isRight(params.decode({ query: { apiKeyId: 'a'.repeat(65) } }))).toBe(false);
    expect(isRight(params.decode({ query: { apiKeyId: 'a'.repeat(64) } }))).toBe(true);
  });
});

describe('verification handler', () => {
  const { handler } = apiEndpointsRouteRepository[verificationEndpoint];

  const getApiKey = jest.fn();
  const query = jest.fn();

  const createResources = ({
    apiKeyId = 'key-id',
    ingestReceiptsEnabled = true,
  }: {
    apiKeyId?: string;
    ingestReceiptsEnabled?: boolean;
  } = {}) =>
    ({
      context: {
        core: Promise.resolve({
          elasticsearch: {
            client: {
              asCurrentUser: { security: { getApiKey } },
              asInternalUser: { esql: { query } },
            },
          },
          featureFlags: {
            getBooleanValue: jest
              .fn()
              .mockImplementation((key: string) =>
                Promise.resolve(key === IS_INGEST_RECEIPTS_ENABLED ? ingestReceiptsEnabled : false)
              ),
          },
        }),
      },
      params: { query: { apiKeyId } },
    } as unknown as Parameters<typeof handler>[0]);

  beforeEach(() => {
    jest.clearAllMocks();
    getApiKey.mockResolvedValue({ api_keys: [{ id: 'key-id' }] });
    query.mockResolvedValue({ columns: [], values: [] });
  });

  it('returns 404 when the ingest receipts flag is off', async () => {
    await expect(handler(createResources({ ingestReceiptsEnabled: false }))).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
    expect(getApiKey).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('returns 404 without searching when the caller owns no active key with that id', async () => {
    getApiKey.mockResolvedValue({ api_keys: [] });

    await expect(handler(createResources())).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns 404 when Elasticsearch does not know the id at all', async () => {
    getApiKey.mockRejectedValue(createEsResponseError(404, { api_keys: [] }));

    await expect(handler(createResources())).rejects.toMatchObject({
      output: { statusCode: 404 },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('propagates ownership check failures other than a missing id', async () => {
    getApiKey.mockRejectedValue(createEsResponseError(503, { error: 'unavailable' }));

    await expect(handler(createResources())).rejects.toMatchObject({ statusCode: 503 });
    expect(query).not.toHaveBeenCalled();
  });

  it('checks ownership with the current user before reading receipts', async () => {
    await handler(createResources());

    expect(getApiKey).toHaveBeenCalledWith({ id: 'key-id', owner: true, active_only: true });
  });

  it('reports a receipt with where it came in when the search matches', async () => {
    query.mockResolvedValue({
      columns: [{ name: 'ingestPath' }, { name: 'signal' }],
      values: [['/v1/metrics', 'metrics']],
    });

    await expect(handler(createResources())).resolves.toEqual({
      received: true,
      ingestPath: '/v1/metrics',
      signal: 'metrics',
    });
  });

  it('reports a receipt without a signal for endpoints that have none', async () => {
    query.mockResolvedValue({
      columns: [{ name: 'ingestPath' }, { name: 'signal' }],
      values: [['/_bulk', null]],
    });

    await expect(handler(createResources())).resolves.toEqual({
      received: true,
      ingestPath: '/_bulk',
      signal: undefined,
    });
  });

  it('reports nothing received when the search returns no hit', async () => {
    await expect(handler(createResources())).resolves.toEqual({ received: false });
  });

  it('tolerates a missing receipts stream instead of failing the request', async () => {
    query.mockRejectedValue(
      new errors.ResponseError({
        statusCode: 400,
        body: {
          error: {
            type: 'verification_exception',
            reason:
              'Found 1 problem\nline 1:6: Unknown index [.kibana-observability-onboarding-receipts]',
          },
        },
        headers: {},
        warnings: [],
        meta: {} as never,
      })
    );

    await expect(handler(createResources())).resolves.toEqual({ received: false });
  });

  it('reads the newest receipt for the API key id within the recency window', async () => {
    await handler(createResources());

    expect(query).toHaveBeenCalledWith({
      query: `FROM ${INGEST_RECEIPTS_DATA_STREAM} | WHERE apiKeyId == ?apiKeyId | SORT @timestamp DESC NULLS LAST | KEEP ingestPath, signal | LIMIT 1`,
      params: [{ apiKeyId: 'key-id' }],
      filter: { range: { '@timestamp': { gte: 'now-15m' } } },
    });
  });

  it('propagates search failures other than a missing stream', async () => {
    query.mockRejectedValue(new Error('search_phase_execution_exception'));

    await expect(handler(createResources())).rejects.toThrow('search_phase_execution_exception');
  });
});
