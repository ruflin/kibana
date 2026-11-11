/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObjectsFindResponse } from '@kbn/core/server';
import { elasticsearchServiceMock, savedObjectsClientMock } from '@kbn/core/server/mocks';
import { loggerMock } from '@kbn/logging-mocks';
import { sweepDeletedSpaces } from './deleted_spaces_sweep';

const spacesFindResponse = (ids: string[]) =>
  ({
    saved_objects: ids.map((id) => ({ id, type: 'space', attributes: {}, references: [] })),
    total: ids.length,
    per_page: 1000,
    page: 1,
  } as unknown as SavedObjectsFindResponse);

const indexedSpacesResponse = (ids: Array<string | null>) => ({
  columns: [{ name: 'space_id', type: 'keyword' }],
  values: ids.map((id) => [id]),
});

const unknownIndexError = () =>
  Object.assign(new Error('verification_exception'), {
    statusCode: 400,
    body: { error: { type: 'verification_exception', reason: 'Unknown index [.cases]' } },
  });

describe('sweepDeletedSpaces', () => {
  const setup = ({ indexed, existing }: { indexed: string[]; existing: string[] }) => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    // The same spaces in every analytics index; the sweep unions them.
    esClient.esql.query.mockResolvedValue(indexedSpacesResponse(indexed) as never);
    esClient.deleteByQuery.mockResolvedValue({ deleted: 3 });

    const savedObjectsClient = savedObjectsClientMock.create();
    savedObjectsClient.find.mockResolvedValue(spacesFindResponse(existing));

    const sweep = () =>
      sweepDeletedSpaces({
        esClient,
        savedObjectsClient,
        logger: loggerMock.create(),
        signal: new AbortController().signal,
      });

    return { esClient, sweep };
  };

  it('deletes the analytics docs of indexed spaces that no longer exist', async () => {
    const { esClient, sweep } = setup({
      indexed: ['default', 'space1', 'deleted-space'],
      existing: ['default', 'space1'],
    });

    await sweep();

    expect(esClient.deleteByQuery).toHaveBeenCalledTimes(1);
    expect(esClient.deleteByQuery.mock.calls[0][0]).toMatchObject({
      index: ['.cases', '.cases-activity', '.cases-attachments'],
      query: { terms: { space_id: ['deleted-space'] } },
    });
  });

  it('never deletes the default space even without a default space saved object', async () => {
    const { esClient, sweep } = setup({ indexed: ['default'], existing: ['space1'] });

    await sweep();

    expect(esClient.deleteByQuery).not.toHaveBeenCalled();
  });

  it('deletes nothing when no spaces are found', async () => {
    const { esClient, sweep } = setup({ indexed: ['space1'], existing: [] });

    await sweep();

    expect(esClient.deleteByQuery).not.toHaveBeenCalled();
  });

  it('reads the distinct space ids of each analytics index, paging by keyset on the last id', async () => {
    const { esClient, sweep } = setup({ indexed: [], existing: ['default'] });
    const fullPage = Array.from({ length: 1000 }, (_, i) => `space-${String(i).padStart(4, '0')}`);
    esClient.esql.query
      .mockResolvedValueOnce(indexedSpacesResponse(fullPage) as never)
      .mockResolvedValueOnce(indexedSpacesResponse(['space-zzzz']) as never)
      .mockResolvedValue(indexedSpacesResponse([]) as never);

    await sweep();

    expect(esClient.esql.query).toHaveBeenCalledTimes(4);
    expect(esClient.esql.query.mock.calls[0][0]).toEqual({
      query:
        'FROM .cases | WHERE space_id IS NOT NULL | STATS BY space_id | SORT space_id ASC | LIMIT 1000',
    });
    expect(esClient.esql.query.mock.calls[1][0]).toEqual({
      query:
        'FROM .cases | WHERE space_id IS NOT NULL AND space_id > ?after | STATS BY space_id | SORT space_id ASC | LIMIT 1000',
      params: [{ after: 'space-0999' }],
    });
    expect(esClient.esql.query.mock.calls[2][0]).toMatchObject({
      query: expect.stringMatching(/^FROM \.cases-activity \|/),
    });
    expect(esClient.deleteByQuery.mock.calls[0][0]).toMatchObject({
      query: { terms: { space_id: expect.arrayContaining(['space-0000', 'space-zzzz']) } },
    });
  });

  it('skips an analytics index that does not exist yet and sweeps the others', async () => {
    const { esClient, sweep } = setup({ indexed: [], existing: ['default'] });
    esClient.esql.query
      .mockRejectedValueOnce(unknownIndexError())
      .mockResolvedValueOnce(indexedSpacesResponse(['deleted-space']) as never)
      .mockResolvedValue(indexedSpacesResponse([]) as never);

    await sweep();

    expect(esClient.deleteByQuery.mock.calls[0][0]).toMatchObject({
      query: { terms: { space_id: ['deleted-space'] } },
    });
  });

  it('propagates other Elasticsearch errors', async () => {
    const { esClient, sweep } = setup({ indexed: [], existing: ['default'] });
    esClient.esql.query.mockRejectedValue(new Error('boom'));

    await expect(sweep()).rejects.toThrow('boom');
  });
});
