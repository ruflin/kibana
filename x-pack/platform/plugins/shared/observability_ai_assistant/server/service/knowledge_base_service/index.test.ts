/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import { DEFAULT_SPACE_ID } from '@kbn/core-spaces-common';
import { KnowledgeBaseService } from '.';

jest.mock('./has_kb_index', () => ({ hasKbWriteIndex: jest.fn().mockResolvedValue(true) }));

describe('KnowledgeBaseService ES|QL reads', () => {
  const esClient = elasticsearchServiceMock.createScopedClusterClient();
  const logger = loggingSystemMock.createLogger();
  const service = new KnowledgeBaseService({
    esClient,
    logger,
    config: { enableKnowledgeBase: true },
  } as never);

  const respond = (columns: string[], values: unknown[][]) =>
    esClient.asInternalUser.esql.query.mockResolvedValue({
      columns: columns.map((name) => ({ name, type: 'keyword' })),
      values,
    } as never);

  const lastRequest = () =>
    esClient.asInternalUser.esql.query.mock.calls.at(-1)![0] as {
      query: string;
      filter: { bool: { filter: unknown[] } };
    };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getUserInstructions reads the user instruction _source with the access filter', async () => {
    respond(['_id', '_source'], [['instruction-1', { text: 'Be brief', public: true }]]);

    const instructions = await service.getUserInstructions(DEFAULT_SPACE_ID, { name: 'johndoe' });

    expect(instructions).toEqual([{ id: 'instruction-1', text: 'Be brief', public: true }]);
    expect(lastRequest().query).toMatch(
      /^FROM [^ ]+ METADATA _id, _source \| KEEP _id, _source \| LIMIT 500$/
    );
    expect(lastRequest().filter.bool.filter[0]).toEqual({ term: { type: 'user_instruction' } });
  });

  it('hasEntries is true when the index returns a row', async () => {
    respond(['_id'], [['entry-1']]);
    expect(await service.hasEntries()).toBe(true);
    expect(lastRequest().query).toMatch(/^FROM [^ ]+ METADATA _id \| KEEP _id \| LIMIT 1$/);

    respond(['_id'], []);
    expect(await service.hasEntries()).toBe(false);
  });

  it('getPersonalUserInstructionId returns the _id of the first row', async () => {
    respond(['_id'], [['instruction-1']]);
    expect(
      await service.getPersonalUserInstructionId({
        isPublic: false,
        user: { name: 'johndoe' },
        namespace: DEFAULT_SPACE_ID,
      })
    ).toBe('instruction-1');

    respond(['_id'], []);
    expect(
      await service.getPersonalUserInstructionId({ isPublic: false, namespace: DEFAULT_SPACE_ID })
    ).toBeUndefined();
  });

  it('getUuidFromDocId filters by doc_id and excludes user instructions', async () => {
    respond(['_id'], [['uuid-1']]);

    expect(await service.getUuidFromDocId({ docId: 'doc-1', namespace: DEFAULT_SPACE_ID })).toBe(
      'uuid-1'
    );
    expect(lastRequest().filter.bool.filter.slice(0, 2)).toEqual([
      { term: { doc_id: 'doc-1' } },
      { bool: { must_not: { term: { type: 'user_instruction' } } } },
    ]);
  });
});
