/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IStorageClient } from '@kbn/storage-adapter';
import {
  ContentClient,
  type ContentStorageSettings,
  type StoredContentPack,
} from './content_client';

describe('ContentClient.getStoredContentPacks', () => {
  it('reads the packs of a stream with a named param and an explicit limit', async () => {
    const pack: StoredContentPack = {
      'stream.name': 'logs',
      'content.name': 'pack',
      dashboards: [],
    };
    const esql = jest.fn().mockResolvedValue({
      columns: [{ name: '_source' }],
      values: [[pack]],
    });
    const client = new ContentClient({
      storageClient: { esql } as unknown as IStorageClient<
        ContentStorageSettings,
        StoredContentPack
      >,
    });

    await expect(client.getStoredContentPacks('logs')).resolves.toEqual([pack]);

    const [{ metadata, pipeline }] = esql.mock.calls[0];
    expect(metadata).toEqual(['_source']);
    expect(pipeline.toRequest()).toEqual({
      query: expect.stringMatching(/WHERE stream\.name == \?streamName\s*\|\s*LIMIT 10000/),
      params: [{ streamName: 'logs' }],
    });
  });
});
