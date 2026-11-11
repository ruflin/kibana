/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { fetchGroupMemberIds, fetchGroupMembers } from './fetch_group_member_ids';

const RESOLVED_TO_FIELD = 'entity.relationships.resolution.resolved_to';

const buildClient = (members: ReadonlyArray<[memberId: string, headId: string]>) => {
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  esClient.esql.query.mockResolvedValue({
    columns: [
      { name: 'entity.id', type: 'keyword' },
      { name: RESOLVED_TO_FIELD, type: 'keyword' },
    ],
    values: members.map(([memberId, headId]) => [memberId, headId]),
  } as never);
  return esClient;
};

describe('fetchGroupMemberIds', () => {
  it('lists the entities resolved to each entity, by its id', async () => {
    const esClient = buildClient([
      ['host:a1', 'host:a'],
      ['host:a2', 'host:a'],
      ['host:b1', 'host:b'],
    ]);

    expect(await fetchGroupMemberIds(esClient, 'default', ['host:a', 'host:b', 'host:c'])).toEqual({
      'host:a': ['host:a1', 'host:a2'],
      'host:b': ['host:b1'],
    });
  });

  it('reads the members of the entities, in the entities of the space', async () => {
    const esClient = buildClient([]);

    await fetchGroupMemberIds(esClient, 'security', ['host:a', 'host:b']);

    expect(esClient.esql.query).toHaveBeenCalledWith(
      {
        query: expect.stringMatching(
          /^FROM \S*security\S* \| WHERE `?entity\.relationships\.resolution\.resolved_to`? IN \(\?entityIds\) \| KEEP/
        ),
        params: [{ entityIds: ['host:a', 'host:b'] }],
      },
      { signal: undefined }
    );
  });

  it('asks for no more hits than a search returns', async () => {
    const esClient = buildClient([]);

    await fetchGroupMemberIds(esClient, 'default', ['host:a']);

    expect(esClient.esql.query).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringContaining('| LIMIT 10000') }),
      expect.anything()
    );
  });

  it('reads nothing without entity ids', async () => {
    const esClient = buildClient([]);

    expect(await fetchGroupMemberIds(esClient, 'default', [])).toEqual({});
    expect(esClient.esql.query).not.toHaveBeenCalled();
  });

  it('fails when the groups have more members than one request reads', async () => {
    const esClient = buildClient(Array.from({ length: 10_000 }, (_, i) => [`host:${i}`, 'host:a']));

    await expect(fetchGroupMemberIds(esClient, 'default', ['host:a'])).rejects.toThrow(
      'too many members'
    );
  });
});

describe('fetchGroupMembers', () => {
  it("returns each member's id with the asked-for fields of its record, nested", async () => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    esClient.esql.query.mockResolvedValueOnce({
      columns: [
        { name: 'entity.id', type: 'keyword' },
        { name: RESOLVED_TO_FIELD, type: 'keyword' },
        { name: '_source', type: '_source' },
      ],
      values: [
        [
          'host:a1',
          'host:a',
          { 'asset.criticality': 'high_impact', 'entity.name': 'not asked for' },
        ],
      ],
    } as never);

    expect(await fetchGroupMembers(esClient, 'default', ['host:a'], ['asset.criticality'])).toEqual(
      {
        'host:a': [{ id: 'host:a1', record: { asset: { criticality: 'high_impact' } } }],
      }
    );
    expect(esClient.esql.query).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.stringMatching(/^FROM \S+ METADATA _source \|/) }),
      expect.anything()
    );
  });
});
