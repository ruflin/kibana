/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { ScopedAnnotationsClient } from '@kbn/observability-plugin/server';
import { AnnotationType } from '../../../../common/annotations';
import { getStoredAnnotations } from './get_stored_annotations';

const annotationsClient = { index: 'observability-annotations' } as ScopedAnnotationsClient;
const logger = { warn: jest.fn() } as unknown as Logger;

const getAnnotations = (esClient: ElasticsearchClient) =>
  getStoredAnnotations({
    serviceName: 'opbeans',
    environment: 'production',
    client: esClient,
    annotationsClient,
    logger,
    start: 0,
    end: 10,
  });

const responseError = (statusCode: number, type: string, reason = '') =>
  new errors.ResponseError({
    statusCode,
    body: { error: { type, reason } },
    headers: {},
    meta: {} as never,
    warnings: [],
  });

describe('getStoredAnnotations', () => {
  it('maps rows to version annotations and keeps multi-valued and DSL-only clauses in the filter', async () => {
    const query = jest.fn().mockResolvedValue({
      columns: [
        { name: '_id', type: 'keyword' },
        { name: '@timestamp', type: 'date' },
        { name: 'message', type: 'keyword' },
      ],
      values: [['id-1', '2024-01-01T00:00:00.000Z', 'v1.0']],
    });

    const result = await getAnnotations({ esql: { query } } as unknown as ElasticsearchClient);

    expect(result).toEqual([
      {
        type: AnnotationType.VERSION,
        id: 'id-1',
        '@timestamp': Date.parse('2024-01-01T00:00:00.000Z'),
        text: 'v1.0',
      },
    ]);
    const request = query.mock.calls[0][0];
    expect(request.query).toBe(
      'FROM observability-annotations METADATA _id | WHERE annotation.type == "deployment" AND service.name == ?serviceName | KEEP _id, @timestamp, message | LIMIT 50'
    );
    expect(request.params).toEqual([{ serviceName: 'opbeans' }]);
    expect(request.filter.bool.filter[0]).toEqual({ term: { tags: 'apm' } });
  });

  it('returns no annotations when the index does not exist', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(responseError(400, 'verification_exception', 'Unknown index [x]'));
    expect(await getAnnotations({ esql: { query } } as unknown as ElasticsearchClient)).toEqual([]);
  });

  it('returns no annotations and warns on a security exception', async () => {
    const query = jest.fn().mockRejectedValue(responseError(403, 'security_exception'));
    expect(await getAnnotations({ esql: { query } } as unknown as ElasticsearchClient)).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('rethrows other errors', async () => {
    const query = jest.fn().mockRejectedValue(responseError(500, 'boom'));
    await expect(
      getAnnotations({ esql: { query } } as unknown as ElasticsearchClient)
    ).rejects.toThrow();
  });
});
