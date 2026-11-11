/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import type { Signal } from '../../common/http_api/signals';
import { getSignalGroups, getSignalsByTag } from './read';

const buildSignal = (overrides: Partial<Signal> = {}): Signal => ({
  signal_id: 'sig-1',
  '@timestamp': '2026-08-01T00:00:00.000Z',
  trace_ids: ['trace-1'],
  signal_type: 'tool_call',
  tags: ['query_error'],
  data: {
    tool: 'esql',
    query_kind: 'ki_retrieval',
    target_index: 'ai-index-ds-support',
    status: 'Error',
    looped: false,
    fell_back_to_raw: false,
    producer: 'agent-builder',
    span_id: 'span-1',
    agent: { id: 'a1', name: 'Support' },
    query: 'FROM ai-index-ds-support | LIMIT 10',
    returned: { columns: [], row_count: 0 },
    error: 'boom',
    duration_ms: 42,
    round_signals: { esql_count: 1, raw_query_count: 0, ki_retrieval_count: 1 },
  },
  ...overrides,
});

describe('getSignalGroups', () => {
  const tagCounts = (rows: Array<[number, string]>) =>
    ({
      columns: [
        { name: 'count', type: 'long' },
        { name: 'tag', type: 'keyword' },
      ],
      values: rows,
    } as any);

  it("counts the tags keyword field of the current space's signals index with STATS", async () => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    esClient.esql.query.mockResolvedValue(
      tagCounts([
        [7, 'query_error'],
        [3, 'empty_retrieval'],
      ])
    );

    const result = await getSignalGroups(esClient, { spaceId: 'default', maxGroups: 100 });

    expect(esClient.esql.query).toHaveBeenCalledWith({
      query:
        'FROM context-engine-signals-default | WHERE tags IS NOT NULL | STATS count = COUNT(*) BY tag = tags | SORT count DESC, tag ASC | LIMIT ?limit',
      params: [{ limit: 100 }],
    });
    expect(result).toEqual({
      groups: [
        { tag: 'query_error', count: 7 },
        { tag: 'empty_retrieval', count: 3 },
      ],
    });
  });

  it('reads the index for the requested space', async () => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    esClient.esql.query.mockResolvedValue(tagCounts([]));

    await getSignalGroups(esClient, { spaceId: 'marketing', maxGroups: 100 });

    expect(esClient.esql.query).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('FROM context-engine-signals-marketing'),
      })
    );
  });

  it('returns an empty group list when the index has no signals', async () => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    esClient.esql.query.mockResolvedValue({ columns: [], values: [] } as any);

    const result = await getSignalGroups(esClient, { spaceId: 'default', maxGroups: 100 });

    expect(result).toEqual({ groups: [] });
  });

  it('returns an empty group list when the index does not exist', async () => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    esClient.esql.query.mockRejectedValue(
      new errors.ResponseError({
        statusCode: 400,
        body: {
          error: {
            type: 'verification_exception',
            reason: 'Unknown index [context-engine-signals-default]',
          },
        },
        warnings: [],
        headers: {},
        meta: {} as never,
      })
    );

    expect(await getSignalGroups(esClient, { spaceId: 'default', maxGroups: 100 })).toEqual({
      groups: [],
    });
  });
});

describe('getSignalsByTag', () => {
  it('fetches the signals for a tag, paginated and newest first', async () => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    const signal = buildSignal();
    esClient.search.mockResolvedValue({
      hits: {
        total: { value: 12 },
        hits: [{ _source: signal }],
      },
    } as any);

    const result = await getSignalsByTag(esClient, {
      spaceId: 'default',
      tag: 'query_error',
      from: 0,
      size: 25,
    });

    expect(esClient.search).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 'context-engine-signals-default',
        from: 0,
        size: 25,
        ignore_unavailable: true,
        allow_no_indices: true,
        track_total_hits: true,
        _source: { excludes: ['data.returned.columns'] },
        query: { bool: { filter: [{ term: { tags: 'query_error' } }] } },
        sort: [{ '@timestamp': { order: 'desc' } }],
      })
    );
    expect(result).toEqual({ signals: [signal], total: 12 });
  });

  it('drops hits without a _source and falls back to the hit count when total is absent', async () => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    const signal = buildSignal();
    esClient.search.mockResolvedValue({
      hits: {
        hits: [{ _source: signal }, {}],
      },
    } as any);

    const result = await getSignalsByTag(esClient, {
      spaceId: 'default',
      tag: 'query_error',
      from: 0,
      size: 25,
    });

    expect(result).toEqual({ signals: [signal], total: 1 });
  });
});
