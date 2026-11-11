/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import { rangeQuery } from '@kbn/observability-plugin/server';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { APMIndices } from '@kbn/apm-sources-access-plugin/server';
import { KIND } from '@kbn/apm-types/es_fields';
import { ENVIRONMENT_ALL_VALUE } from '../../../common/environment_filter_values';
import {
  PROCESSOR_EVENT,
  RESOURCE_ATTRIBUTES_DEPLOYMENT_ENVIRONMENT_NAME,
  SERVICE_ENVIRONMENT,
} from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import { getServiceSchemaType } from './get_service_schema_type';

const start = 1_700_000_000_000;
const end = 1_700_000_900_000;

const indices = {
  transaction: 'traces-apm*,apm-*',
  span: 'traces-apm*,apm-*,traces-*.otel-*',
} as unknown as APMIndices;

const baseParams = {
  indices,
  serviceName: 'my-service',
  environment: ENVIRONMENT_ALL_VALUE,
  start,
  end,
};

function makeHitsResponse(rows: number) {
  return {
    columns: [{ name: 'service.name', type: 'keyword' }],
    values: Array.from({ length: rows }, () => ['my-service']),
  };
}

function makeEsClient(counts: { ecs?: number; otel?: number } = {}): ElasticsearchClient {
  const mock = jest.fn();
  mock.mockResolvedValueOnce(makeHitsResponse(counts.ecs ?? 0));
  mock.mockResolvedValueOnce(makeHitsResponse(counts.otel ?? 0));
  return { esql: { query: mock } } as unknown as ElasticsearchClient;
}

function getSearchCall(esClient: ElasticsearchClient, callIndex: number) {
  return (esClient.esql.query as jest.Mock).mock.calls[callIndex]?.[0];
}

function getFilterClauses(esClient: ElasticsearchClient, callIndex: number) {
  return getSearchCall(esClient, callIndex)?.filter?.bool?.filter ?? [];
}

describe('getServiceSchemaType', () => {
  describe('schema type resolution', () => {
    it('returns ecs when ecs query has matches', async () => {
      const esClient = makeEsClient({ ecs: 1 });
      const result = await getServiceSchemaType({ esClient, ...baseParams });
      expect(result).toEqual({ schema: 'ecs' });
    });

    it('returns ecs when both queries have matches', async () => {
      const esClient = makeEsClient({ ecs: 1, otel: 1 });
      const result = await getServiceSchemaType({ esClient, ...baseParams });
      expect(result).toEqual({ schema: 'ecs' });
    });

    it('returns otel when only otel query has matches', async () => {
      const esClient = makeEsClient({ ecs: 0, otel: 1 });
      const result = await getServiceSchemaType({ esClient, ...baseParams });
      expect(result).toEqual({ schema: 'otel' });
    });

    it('returns unknown when both queries have no matches', async () => {
      const esClient = makeEsClient({ ecs: 0, otel: 0 });
      const result = await getServiceSchemaType({ esClient, ...baseParams });
      expect(result).toEqual({ schema: 'unknown' });
    });

    it('returns unknown when both indices are empty strings', async () => {
      const emptyIndices = { transaction: '', span: '' } as unknown as APMIndices;
      const esClient = makeEsClient();
      const result = await getServiceSchemaType({ esClient, ...baseParams, indices: emptyIndices });
      expect(result).toEqual({ schema: 'unknown' });
      expect(esClient.esql.query).not.toHaveBeenCalled();
    });
  });

  describe('query structure', () => {
    it('runs two parallel queries', async () => {
      const esClient = makeEsClient();
      await getServiceSchemaType({ esClient, ...baseParams });
      expect((esClient.esql.query as jest.Mock).mock.calls).toHaveLength(2);
    });

    it('searches against the combined transaction and span indices for both queries', async () => {
      const esClient = makeEsClient();
      await getServiceSchemaType({ esClient, ...baseParams });
      expect(getSearchCall(esClient, 0).query).toContain(
        'FROM traces-apm*, apm-*, traces-*.otel-* |'
      );
      expect(getSearchCall(esClient, 1).query).toContain(
        'FROM traces-apm*, apm-*, traces-*.otel-* |'
      );
    });

    it('deduplicates when transaction and span indices are identical', async () => {
      const sameIndices = {
        transaction: 'traces-apm*,apm-*',
        span: 'traces-apm*,apm-*',
      } as unknown as APMIndices;
      const esClient = makeEsClient();
      await getServiceSchemaType({ esClient, ...baseParams, indices: sameIndices });
      expect(getSearchCall(esClient, 0).query).toContain('FROM traces-apm*, apm-* |');
      expect(getSearchCall(esClient, 1).query).toContain('FROM traces-apm*, apm-* |');
    });

    it('limits both queries to one row and reads unmapped fields as null', async () => {
      const esClient = makeEsClient();
      await getServiceSchemaType({ esClient, ...baseParams });
      for (const callIndex of [0, 1]) {
        expect(getSearchCall(esClient, callIndex).query).toMatch(
          /^SET unmapped_fields = "nullify"; FROM .* \| LIMIT 1$/
        );
      }
    });

    it('filters by service name in both queries', async () => {
      const esClient = makeEsClient();
      await getServiceSchemaType({ esClient, ...baseParams });
      for (const callIndex of [0, 1]) {
        expect(getSearchCall(esClient, callIndex).query).toContain('service.name == ?serviceName');
        expect(getSearchCall(esClient, callIndex).params).toContainEqual({
          serviceName: 'my-service',
        });
      }
    });

    it('filters by the time range in both queries', async () => {
      const esClient = makeEsClient();
      await getServiceSchemaType({ esClient, ...baseParams });
      expect(getFilterClauses(esClient, 0)).toEqual(rangeQuery(start, end));
      expect(getFilterClauses(esClient, 1)).toEqual(rangeQuery(start, end));
    });

    it('ecs query filters by existence of processor.event', async () => {
      const esClient = makeEsClient();
      await getServiceSchemaType({ esClient, ...baseParams });
      expect(getSearchCall(esClient, 0).params).toContainEqual({ p1: PROCESSOR_EVENT });
      expect(getSearchCall(esClient, 0).query).toContain('??p1 IS NOT NULL');
    });

    it('otel query filters by existence of kind', async () => {
      const esClient = makeEsClient();
      await getServiceSchemaType({ esClient, ...baseParams });
      expect(getSearchCall(esClient, 1).params).toContainEqual({ p1: KIND });
      expect(getSearchCall(esClient, 1).query).toContain('??p1 IS NOT NULL');
    });

    it('treats a missing index as no matches', async () => {
      const error = new errors.ResponseError({
        statusCode: 400,
        body: { error: { type: 'verification_exception', reason: 'Unknown index [x]' } },
        headers: {},
        meta: {} as never,
        warnings: [],
      });
      const esClient = {
        esql: { query: jest.fn().mockRejectedValue(error) },
      } as unknown as ElasticsearchClient;
      expect(await getServiceSchemaType({ esClient, ...baseParams })).toEqual({
        schema: 'unknown',
      });
    });
  });

  describe('environment filtering', () => {
    it('does not add an environment filter when ENVIRONMENT_ALL is used', async () => {
      const esClient = makeEsClient();
      await getServiceSchemaType({
        esClient,
        ...baseParams,
        environment: ENVIRONMENT_ALL_VALUE,
      });
      const serializedFilters = JSON.stringify(getFilterClauses(esClient, 0));
      expect(serializedFilters).not.toContain(SERVICE_ENVIRONMENT);
      expect(serializedFilters).not.toContain(RESOURCE_ATTRIBUTES_DEPLOYMENT_ENVIRONMENT_NAME);
    });

    it('adds an environment filter for a specific environment', async () => {
      const esClient = makeEsClient();
      await getServiceSchemaType({ esClient, ...baseParams, environment: 'production' });
      expect(getFilterClauses(esClient, 0)).toEqual(
        expect.arrayContaining(environmentQuery('production'))
      );
    });
  });
});
