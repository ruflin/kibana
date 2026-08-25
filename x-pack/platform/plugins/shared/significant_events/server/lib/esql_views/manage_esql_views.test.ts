/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { getDataStreams, listDataStreams } from './manage_esql_views';

describe('listDataStreams', () => {
  const logger = { debug: jest.fn() } as unknown as Logger;

  it('omits hidden data streams and sorts names', async () => {
    const esClient = {
      indices: {
        getDataStream: jest.fn().mockResolvedValue({
          data_streams: [{ name: 'logs-b' }, { name: '.internal' }, { name: 'logs-a' }],
        }),
      },
    } as unknown as ElasticsearchClient;

    await expect(listDataStreams({ esClient, logger })).resolves.toEqual(['logs-a', 'logs-b']);
  });

  it('returns an empty list when the catalog is unavailable', async () => {
    const esClient = {
      indices: {
        getDataStream: jest.fn().mockRejectedValue(new Error('unavailable')),
      },
    } as unknown as ElasticsearchClient;

    await expect(listDataStreams({ esClient, logger })).resolves.toEqual([]);
  });
});

describe('getDataStreams', () => {
  it('returns names from Elasticsearch', async () => {
    const esClient = {
      indices: {
        getDataStream: jest.fn().mockResolvedValue({
          data_streams: [{ name: 'logs-foo' }, { name: 'logs-bar' }],
        }),
      },
    } as unknown as ElasticsearchClient;

    await expect(getDataStreams({ esClient, names: ['logs-foo', 'logs-bar'] })).resolves.toEqual([
      'logs-foo',
      'logs-bar',
    ]);
    expect(esClient.indices.getDataStream).toHaveBeenCalledWith({
      name: ['logs-foo', 'logs-bar'],
    });
  });
});
