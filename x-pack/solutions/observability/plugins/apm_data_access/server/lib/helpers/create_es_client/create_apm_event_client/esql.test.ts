/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import { esql } from '@elastic/esql';
import type { ElasticsearchClient, KibanaRequest } from '@kbn/core/server';
import { ProcessorEvent } from '@kbn/apm-types-shared';
import type { APMIndices } from '@kbn/apm-sources-access-plugin/server';
import { EMPTY } from 'rxjs';
import { APMEventClient } from '.';

describe('APMEventClient esql', () => {
  const indices = {
    transaction: 'traces-apm*',
    span: 'traces-apm*',
    metric: 'metrics-apm*',
    error: 'logs-apm*',
  } as unknown as APMIndices;

  const unknownIndex = () =>
    new errors.ResponseError({
      statusCode: 400,
      body: {
        error: { type: 'verification_exception', reason: 'Unknown index [traces-apm*]' },
      },
      warnings: null,
      meta: {} as never,
    });

  const createClient = (query: jest.Mock, projectRouting?: string) =>
    new APMEventClient({
      esClient: { esql: { query } } as unknown as ElasticsearchClient,
      debug: false,
      request: { events: { aborted$: EMPTY } } as unknown as KibanaRequest,
      indices,
      options: { includeFrozen: false, projectRouting },
    });

  it('reads the resolved indices and passes the processor-event filter as a request filter', async () => {
    const query = jest.fn().mockResolvedValue({ body: { columns: [], values: [] } });
    const client = createClient(query);

    await client.esql('test', {
      apm: { events: [ProcessorEvent.transaction] },
      query: (index) => esql.from(index, ['@timestamp']).pipe`LIMIT 10`,
    });

    const request = query.mock.calls[0][0];
    expect(request.query).toContain('FROM traces-apm*');
    expect(request.query).toContain('LIMIT 10');
    expect(request.filter).toEqual({
      bool: { filter: [{ terms: { 'processor.event': ['transaction'] } }] },
    });
    expect(request).not.toHaveProperty('project_routing');
  });

  it('adds the caller filter and project routing', async () => {
    const query = jest.fn().mockResolvedValue({ body: { columns: [], values: [] } });
    const client = createClient(query, '_alias:_origin');

    await client.esql('test', {
      apm: { events: [ProcessorEvent.error] },
      query: (index) => esql.from(index, ['@timestamp']).pipe`LIMIT 1`,
      filter: { term: { 'service.name': 'opbeans' } },
    });

    const request = query.mock.calls[0][0];
    expect(request.filter.bool.filter).toContainEqual({ term: { 'service.name': 'opbeans' } });
    expect(request.project_routing).toBe('_alias:_origin');
  });

  it('resolves to undefined when no index matches', async () => {
    const query = jest.fn(() => Promise.reject(unknownIndex()));
    const client = createClient(query);

    await expect(
      client.esql('test', {
        apm: { events: [ProcessorEvent.transaction] },
        query: (index) => esql.from(index, ['@timestamp']).pipe`LIMIT 1`,
      })
    ).resolves.toBeUndefined();
  });

  it('rethrows other errors', async () => {
    const query = jest.fn(() => Promise.reject(new Error('boom')));
    const client = createClient(query);

    await expect(
      client.esql('test', {
        apm: { events: [ProcessorEvent.transaction] },
        query: (index) => esql.from(index, ['@timestamp']).pipe`LIMIT 1`,
      })
    ).rejects.toThrow('boom');
  });
});
