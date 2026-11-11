/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StreamsStorageClient } from './streams_storage_client';
import { readStreamDefinitions } from './read_stream_definitions';

const makeClient = (response: { columns: Array<{ name: string }>; values: unknown[][] }) => {
  const esql = jest.fn().mockResolvedValue(response);
  return { esql, client: { esql } as unknown as StreamsStorageClient };
};

describe('readStreamDefinitions', () => {
  it('sorts by name, caps the rows and reads the _source', async () => {
    const { esql, client } = makeClient({
      columns: [{ name: '_source' }],
      values: [[{ name: 'logs' }], [{ name: 'logs.child' }]],
    });

    await expect(readStreamDefinitions(client)).resolves.toEqual([
      { name: 'logs' },
      { name: 'logs.child' },
    ]);

    const [{ metadata, pipeline }] = esql.mock.calls[0];
    expect(metadata).toEqual(['_source']);
    expect(pipeline.toRequest().query).toMatch(/SORT name ASC NULLS LAST\s*\|\s*LIMIT 10000/);
  });

  it('returns no definitions when the index has no rows', async () => {
    const { client } = makeClient({ columns: [], values: [] });

    await expect(readStreamDefinitions(client)).resolves.toEqual([]);
  });
});
