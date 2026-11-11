/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import type { ModelProvider } from '@kbn/agent-builder-server';
import { extractFieldPaths, listFieldsHandler } from './get_index_fields_handler';

describe('extractFieldPaths', () => {
  it('extracts top-level keys from a flat object', () => {
    expect(extractFieldPaths({ a: 1, b: 'hello' })).toEqual(['a', 'b']);
  });

  it('extracts dot-notation paths from nested objects', () => {
    expect(extractFieldPaths({ a: { b: 1, c: 2 } })).toEqual(['a.b', 'a.c']);
  });

  it('handles deeply nested objects', () => {
    expect(extractFieldPaths({ a: { b: { c: { d: 1 } } } })).toEqual(['a.b.c.d']);
  });

  it('treats arrays as leaf values', () => {
    expect(extractFieldPaths({ tags: ['foo', 'bar'] })).toEqual(['tags']);
  });

  it('treats null as a leaf value', () => {
    expect(extractFieldPaths({ a: null })).toEqual(['a']);
  });

  it('returns an empty array for an empty object', () => {
    expect(extractFieldPaths({})).toEqual([]);
  });

  it('handles a mix of nested and leaf values', () => {
    const result = extractFieldPaths({
      service: { name: 'web', environment: 'prod' },
      '@timestamp': '2024-01-01',
      tags: ['a'],
      host: { os: { platform: 'linux' } },
    });

    expect(result).toEqual([
      'service.name',
      'service.environment',
      '@timestamp',
      'tags',
      'host.os.platform',
    ]);
  });
});

describe('listFieldsHandler', () => {
  const esClient = elasticsearchServiceMock.createScopedClusterClient();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const run = () =>
    listFieldsHandler({
      esClient,
      index: 'logs-*',
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-01T01:00:00.000Z',
      kqlFilter: 'service.name: a',
      modelProvider: {} as ModelProvider,
      logger: loggingSystemMock.createLogger(),
    });

  it('samples the _source of 1000 documents with ES|QL and groups the fields by type', async () => {
    esClient.asCurrentUser.esql.query.mockResolvedValue({
      columns: [{ name: '_source', type: '_source' }],
      values: [
        [{ '@timestamp': '2026-01-01T00:00:00.000Z', service: { name: 'a' } }],
        [{ message: 'boom', service: { name: 'b' } }],
      ],
    } as never);
    esClient.asCurrentUser.fieldCaps.mockResolvedValue({
      indices: ['logs-1'],
      fields: {
        '@timestamp': { date: {} as never },
        'service.name': { keyword: {} as never },
        message: { text: {} as never },
      },
    });

    const result = await run();

    const request = esClient.asCurrentUser.esql.query.mock.calls[0][0] as {
      query: string;
      params: unknown[];
    };
    expect(request.query).toBe('FROM logs-* METADATA _source | KEEP _source | LIMIT ?limit');
    expect(request.params).toEqual([{ limit: 1000 }]);
    expect(esClient.asCurrentUser.fieldCaps).toHaveBeenCalledWith(
      expect.objectContaining({ fields: ['@timestamp', 'service.name', 'message'] })
    );
    expect(result).toEqual({
      fieldsByType: {
        date: ['@timestamp'],
        keyword: ['service.name'],
        text: ['message'],
      },
    });
    expect(esClient.asCurrentUser.search).not.toHaveBeenCalled();
  });

  it('reports no fields when the index pattern matches nothing', async () => {
    esClient.asCurrentUser.esql.query.mockRejectedValue(
      Object.assign(new Error('Unknown index [logs-*]'), {
        statusCode: 400,
        body: { error: { type: 'verification_exception', reason: 'Unknown index [logs-*]' } },
      })
    );

    expect(await run()).toEqual({
      fieldsByType: {},
      message: 'No documents found in index or no fields with data.',
    });
  });
});
