/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { kibanaResponseFactory } from '@kbn/core/server';
import type { MockRouter } from './__mocks__/routes.mock';
import { createMockRouter, routeHandlerContextMock } from './__mocks__/routes.mock';
import { createRequestMock } from './__mocks__/request.mock';
import { handleEsError } from '../shared_imports';

jest.mock('@kbn/upgrade-assistant-pkg-server', () => ({
  versionCheckHandlerWrapper: () => (a: any) => a,
}));

import { registerDeprecationLoggingRoutes } from './deprecation_logging';

/**
 * Since these route callbacks are so thin, these serve simply as integration tests
 * to ensure they're wired up to the lib functions correctly. Business logic is tested
 * more thoroughly in the es_deprecation_logging_apis test.
 */
describe('deprecation logging API', () => {
  let mockRouter: MockRouter;
  let routeDependencies: any;

  beforeEach(() => {
    mockRouter = createMockRouter();
    routeDependencies = {
      router: mockRouter,
      lib: { handleEsError },
      current: { major: 8 },
    };
    registerDeprecationLoggingRoutes(routeDependencies);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('GET /api/upgrade_assistant/deprecation_logging', () => {
    it('returns that indexing and writing logs is enabled', async () => {
      (
        routeHandlerContextMock.core.elasticsearch.client.asCurrentUser.cluster
          .getSettings as jest.Mock
      ).mockResolvedValue({
        defaults: {
          cluster: { deprecation_indexing: { enabled: 'true' } },
        },
      });

      const resp = await routeDependencies.router.getHandler({
        method: 'get',
        pathPattern: '/api/upgrade_assistant/deprecation_logging',
      })(routeHandlerContextMock, createRequestMock(), kibanaResponseFactory);

      expect(resp.status).toEqual(200);
      expect(resp.payload).toEqual({
        isDeprecationLogIndexingEnabled: true,
        isDeprecationLoggingEnabled: true,
      });
    });

    it('returns an error if it throws', async () => {
      (
        routeHandlerContextMock.core.elasticsearch.client.asCurrentUser.cluster
          .getSettings as jest.Mock
      ).mockRejectedValue(new Error('scary error!'));
      await expect(
        routeDependencies.router.getHandler({
          method: 'get',
          pathPattern: '/api/upgrade_assistant/deprecation_logging',
        })(routeHandlerContextMock, createRequestMock(), kibanaResponseFactory)
      ).rejects.toThrow('scary error!');
    });
  });

  describe('PUT /api/upgrade_assistant/deprecation_logging', () => {
    it('returns that indexing and writing logs is enabled', async () => {
      (
        routeHandlerContextMock.core.elasticsearch.client.asCurrentUser.cluster
          .putSettings as jest.Mock
      ).mockResolvedValue({
        defaults: {
          logger: { deprecation: 'WARN' },
          cluster: { deprecation_indexing: { enabled: 'true' } },
        },
      });

      const resp = await routeDependencies.router.getHandler({
        method: 'put',
        pathPattern: '/api/upgrade_assistant/deprecation_logging',
      })(routeHandlerContextMock, { body: { isEnabled: true } }, kibanaResponseFactory);

      expect(resp.payload).toEqual({
        isDeprecationLogIndexingEnabled: true,
        isDeprecationLoggingEnabled: true,
      });
    });

    it('returns an error if it throws', async () => {
      (
        routeHandlerContextMock.core.elasticsearch.client.asCurrentUser.cluster
          .putSettings as jest.Mock
      ).mockRejectedValue(new Error('scary error!'));
      await expect(
        routeDependencies.router.getHandler({
          method: 'put',
          pathPattern: '/api/upgrade_assistant/deprecation_logging',
        })(routeHandlerContextMock, { body: { isEnabled: false } }, kibanaResponseFactory)
      ).rejects.toThrow('scary error!');
    });
  });

  describe('GET /api/upgrade_assistant/deprecation_logging/count', () => {
    const MOCK_FROM_DATE = '2021-08-23T07:32:34.782Z';

    it('returns count of deprecations', async () => {
      (
        routeHandlerContextMock.core.elasticsearch.client.asCurrentUser.indices.exists as jest.Mock
      ).mockResolvedValue(true);
      (
        routeHandlerContextMock.core.elasticsearch.client.asCurrentUser.esql.query as jest.Mock
      ).mockResolvedValue({ columns: [{ name: 'count', type: 'long' }], values: [[10]] });

      const resp = await routeDependencies.router.getHandler({
        method: 'get',
        pathPattern: '/api/upgrade_assistant/deprecation_logging/count',
      })(
        routeHandlerContextMock,
        createRequestMock({ query: { from: MOCK_FROM_DATE } }),
        kibanaResponseFactory
      );

      expect(resp.status).toEqual(200);
      expect(resp.payload).toEqual({ count: 10 });

      const request = (
        routeHandlerContextMock.core.elasticsearch.client.asCurrentUser.esql.query as jest.Mock
      ).mock.calls[0][0];
      // documents without an origin count too
      expect(request.query).toBe(
        'FROM .logs-deprecation.elasticsearch-default | WHERE @timestamp >= TO_DATETIME(?from) AND @timestamp <= TO_DATETIME(?now) AND (`elasticsearch.elastic_product_origin` IS NULL OR NOT (`elasticsearch.elastic_product_origin` IN (?origins))) | STATS count = COUNT(*)'
      );
      expect(request.params).toEqual([
        { from: MOCK_FROM_DATE },
        { now: expect.any(String) },
        { origins: expect.arrayContaining(['kibana', 'fleet']) },
      ]);
    });

    it('returns zero matches when deprecation logs index is not created', async () => {
      (
        routeHandlerContextMock.core.elasticsearch.client.asCurrentUser.indices.exists as jest.Mock
      ).mockResolvedValue(false);

      const resp = await routeDependencies.router.getHandler({
        method: 'get',
        pathPattern: '/api/upgrade_assistant/deprecation_logging/count',
      })(
        routeHandlerContextMock,
        createRequestMock({ query: { from: MOCK_FROM_DATE } }),
        kibanaResponseFactory
      );

      expect(resp.status).toEqual(200);
      expect(resp.payload).toEqual({ count: 0 });
    });

    it('returns an error if it throws', async () => {
      (
        routeHandlerContextMock.core.elasticsearch.client.asCurrentUser.indices.exists as jest.Mock
      ).mockRejectedValue(new Error('scary error!'));
      await expect(
        routeDependencies.router.getHandler({
          method: 'get',
          pathPattern: '/api/upgrade_assistant/deprecation_logging/count',
        })(routeHandlerContextMock, createRequestMock(), kibanaResponseFactory)
      ).rejects.toThrow('scary error!');
    });
  });

  describe('DELETE /api/upgrade_assistant/deprecation_logging/cache', () => {
    it('returns ok if if the cache was deleted', async () => {
      (
        routeHandlerContextMock.core.elasticsearch.client.asCurrentUser.transport
          .request as jest.Mock
      ).mockResolvedValue('ok');

      const resp = await routeDependencies.router.getHandler({
        method: 'delete',
        pathPattern: '/api/upgrade_assistant/deprecation_logging/cache',
      })(routeHandlerContextMock, createRequestMock(), kibanaResponseFactory);

      expect(resp.status).toEqual(200);
      expect(
        routeHandlerContextMock.core.elasticsearch.client.asCurrentUser.transport.request
      ).toHaveBeenCalledWith({
        method: 'DELETE',
        path: '/_logging/deprecation_cache',
      });
      expect(resp.payload).toEqual('ok');
    });

    it('returns an error if it throws', async () => {
      (
        routeHandlerContextMock.core.elasticsearch.client.asCurrentUser.transport
          .request as jest.Mock
      ).mockRejectedValue(new Error('scary error!'));
      await expect(
        routeDependencies.router.getHandler({
          method: 'delete',
          pathPattern: '/api/upgrade_assistant/deprecation_logging/cache',
        })(routeHandlerContextMock, createRequestMock(), kibanaResponseFactory)
      ).rejects.toThrow('scary error!');
    });
  });
});
