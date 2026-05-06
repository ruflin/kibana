/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggerMock } from '@kbn/logging-mocks';
import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';
import { createClient } from './client';
import * as storageModule from './storage';

describe('ConversationClient.list', () => {
  const buildSearchResponse = (
    hits: Array<{ id: string; hidden?: boolean; agentId?: string }> = []
  ) => ({
    hits: {
      hits: hits.map((h) => ({
        _id: h.id,
        _source: {
          agent_id: h.agentId ?? 'agent_id',
          user_id: 'user-1',
          user_name: 'user-1',
          space: 'default',
          title: 'Title',
          created_at: '2026-05-06T10:00:00.000Z',
          updated_at: '2026-05-06T10:00:00.000Z',
          conversation_rounds: [],
          ...(h.hidden ? { hidden: true } : {}),
        },
      })),
    },
  });

  const installStorageMock = (search: jest.Mock) => {
    jest.spyOn(storageModule, 'createStorage').mockReturnValue({
      getClient: () => ({ search } as any),
    } as any);
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const buildClient = () =>
    createClient({
      space: 'default',
      logger: loggerMock.create(),
      esClient: elasticsearchServiceMock.createElasticsearchClient(),
      user: { id: 'user-1', username: 'user-1' },
    });

  it('excludes hidden conversations from the search by default', async () => {
    const search = jest.fn().mockResolvedValue(buildSearchResponse());
    installStorageMock(search);

    await buildClient().list();

    expect(search).toHaveBeenCalledTimes(1);
    const query = search.mock.calls[0][0].query;
    expect(query.bool.must_not).toEqual([{ term: { hidden: true } }]);
  });

  it('excludes hidden conversations when includeHidden is explicitly false', async () => {
    const search = jest.fn().mockResolvedValue(buildSearchResponse());
    installStorageMock(search);

    await buildClient().list({ includeHidden: false });

    const query = search.mock.calls[0][0].query;
    expect(query.bool.must_not).toEqual([{ term: { hidden: true } }]);
  });

  it('includes hidden conversations when includeHidden is true', async () => {
    const search = jest.fn().mockResolvedValue(buildSearchResponse());
    installStorageMock(search);

    await buildClient().list({ includeHidden: true });

    const query = search.mock.calls[0][0].query;
    expect(query.bool.must_not).toEqual([]);
  });

  it('requests the `hidden` field in `_source` so list rows know their state', async () => {
    const search = jest.fn().mockResolvedValue(buildSearchResponse());
    installStorageMock(search);

    await buildClient().list();

    const args = search.mock.calls[0][0];
    expect(args._source).toEqual(
      expect.arrayContaining([
        'agent_id',
        'user_id',
        'user_name',
        'title',
        'created_at',
        'updated_at',
        'hidden',
      ])
    );
  });

  it('still applies the agentId filter when present', async () => {
    const search = jest.fn().mockResolvedValue(buildSearchResponse());
    installStorageMock(search);

    await buildClient().list({ agentId: 'my-agent' });

    const must = search.mock.calls[0][0].query.bool.must;
    expect(must).toEqual(
      expect.arrayContaining([
        { term: { user_name: 'user-1' } },
        { term: { agent_id: 'my-agent' } },
      ])
    );
  });

  it('surfaces `hidden` on returned conversations when includeHidden is true', async () => {
    const search = jest
      .fn()
      .mockResolvedValue(
        buildSearchResponse([{ id: 'visible-1' }, { id: 'hidden-1', hidden: true }])
      );
    installStorageMock(search);

    const result = await buildClient().list({ includeHidden: true });

    expect(result).toHaveLength(2);
    const hiddenRow = result.find((c) => c.id === 'hidden-1');
    const visibleRow = result.find((c) => c.id === 'visible-1');
    expect(hiddenRow?.hidden).toBe(true);
    expect(visibleRow?.hidden).toBeUndefined();
  });
});
