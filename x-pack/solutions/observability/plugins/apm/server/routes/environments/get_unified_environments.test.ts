/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { rangeQuery } from '@kbn/observability-plugin/server';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { APMIndices } from '@kbn/apm-sources-access-plugin/server';
import { getUnifiedEnvironments } from './get_unified_environments';

const indices = {
  transaction: 'traces-apm*',
  span: 'traces-otel*',
} as unknown as APMIndices;

const baseArgs = {
  indices,
  serviceName: 'my-service',
  start: 0,
  end: 1,
  size: 100,
};

function makeEsClient(
  envs: string[],
  missingCount: number,
  otelEnvs: string[] = []
): ElasticsearchClient {
  return {
    esql: {
      query: jest.fn().mockResolvedValue({
        columns: [
          { name: 'environments', type: 'keyword' },
          { name: 'otel_environments', type: 'keyword' },
          { name: 'missing_environments', type: 'long' },
        ],
        values: [[envs, otelEnvs, missingCount]],
      }),
    },
  } as unknown as ElasticsearchClient;
}

describe('getUnifiedEnvironments', () => {
  it('returns environments from APM-processed data', async () => {
    const esClient = makeEsClient(['production', 'staging'], 0);
    const result = await getUnifiedEnvironments({ esClient, ...baseArgs });
    expect(result).toEqual(['production', 'staging']);
  });

  it('returns environments from unprocessed OTel data', async () => {
    const esClient = makeEsClient(['dev'], 0);
    const result = await getUnifiedEnvironments({ esClient, ...baseArgs });
    expect(result).toEqual(['dev']);
  });

  it('merges environments from deployment.environment.name with service.environment', async () => {
    const esClient = makeEsClient(['production'], 0, ['dev', 'production']);
    const result = await getUnifiedEnvironments({ esClient, ...baseArgs });
    expect(result).toEqual(['dev', 'production']);
  });

  it('appends ENVIRONMENT_NOT_DEFINED when docs have no service.environment', async () => {
    const esClient = makeEsClient(['production'], 3);
    const result = await getUnifiedEnvironments({ esClient, ...baseArgs });
    expect(result).toEqual(['production', 'ENVIRONMENT_NOT_DEFINED']);
  });

  it('returns only ENVIRONMENT_NOT_DEFINED when all docs lack service.environment', async () => {
    const esClient = makeEsClient([], 5);
    const result = await getUnifiedEnvironments({ esClient, ...baseArgs });
    expect(result).toEqual(['ENVIRONMENT_NOT_DEFINED']);
  });

  it('returns empty array when there are no matching documents', async () => {
    const esClient = makeEsClient([], 0);
    const result = await getUnifiedEnvironments({ esClient, ...baseArgs });
    expect(result).toEqual([]);
  });

  it('returns empty array without searching when both indices are empty strings', async () => {
    const searchSpy = jest.fn();
    const esClient = { esql: { query: searchSpy } } as unknown as ElasticsearchClient;
    const emptyIndices = { transaction: '', span: '' } as unknown as APMIndices;
    const result = await getUnifiedEnvironments({ esClient, ...baseArgs, indices: emptyIndices });
    expect(result).toEqual([]);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('reads a single value, which ES|QL returns as a scalar, and caps each field at size', async () => {
    const esClient = {
      esql: {
        query: jest.fn().mockResolvedValue({
          columns: [
            { name: 'environments', type: 'keyword' },
            { name: 'otel_environments', type: 'keyword' },
            { name: 'missing_environments', type: 'long' },
          ],
          values: [['staging', ['c', 'b', 'a'], 0]],
        }),
      },
    } as unknown as ElasticsearchClient;
    const result = await getUnifiedEnvironments({ esClient, ...baseArgs, size: 2 });
    expect(result).toEqual(['a', 'b', 'staging']);
  });

  it('queries transactions and unprocessed OTel server spans of the service in the range', async () => {
    const esClient = makeEsClient([], 0);
    await getUnifiedEnvironments({ esClient, ...baseArgs });
    const request = (esClient.esql.query as jest.Mock).mock.calls[0][0];
    expect(request.query).toBe(
      'SET unmapped_fields = "nullify"; FROM traces-apm*, traces-otel* | WHERE service.name == ?serviceName | WHERE processor.event == "transaction" OR (kind IN ("Server", "Consumer")) AND processor.event IS NULL | STATS environments = VALUES(service.environment), otel_environments = VALUES(resource.attributes.deployment.environment.name), missing_environments = COUNT(*) WHERE service.environment IS NULL AND resource.attributes.deployment.environment.name IS NULL'
    );
    expect(request.params).toEqual([{ serviceName: 'my-service' }]);
    expect(request.filter.bool.filter).toEqual(rangeQuery(0, 1));
  });
});
