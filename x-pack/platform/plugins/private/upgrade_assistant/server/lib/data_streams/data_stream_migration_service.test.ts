/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import type { LicensingPluginSetup } from '@kbn/licensing-plugin/server';

import { dataStreamMigrationServiceFactory } from './data_stream_migration_service';

describe('dataStreamMigrationService getDataStreamMetadata', () => {
  const esClient = elasticsearchServiceMock.createElasticsearchClient();

  const getMetadata = () =>
    dataStreamMigrationServiceFactory({
      esClient,
      log: loggingSystemMock.createLogger(),
      licensing: {} as LicensingPluginSetup,
    }).getDataStreamMetadata('my-stream');

  beforeEach(() => {
    jest.clearAllMocks();
    esClient.transport.request.mockResolvedValue({
      body: {
        indices: {
          'index-a': {
            primaries: { store: { total_data_set_size_in_bytes: 10 }, docs: { count: 2 } },
          },
          'index-b': {
            primaries: { store: { total_data_set_size_in_bytes: 20 }, docs: { count: 0 } },
          },
        },
      },
    });
    esClient.migration.deprecations.mockResolvedValue({
      data_streams: {
        'my-stream': [
          {
            url: 'https://docs',
            _meta: { reindex_required: true, indices_requiring_upgrade: ['index-a', 'index-b'] },
          },
        ],
      },
    } as never);
    esClient.indices.getSettings.mockResolvedValue({
      'index-a': { settings: { 'index.creation_date': '1' } },
      'index-b': { settings: { 'index.creation_date': '2' } },
    } as never);
  });

  it('reads the oldest document timestamp of the indices that have documents', async () => {
    esClient.esql.query.mockResolvedValue({
      columns: [{ name: 'oldest_incompatible_doc', type: 'date' }],
      values: [['2024-01-02T03:04:05.678Z']],
    } as never);

    const metadata = await getMetadata();

    expect(esClient.esql.query).toHaveBeenCalledTimes(1);
    expect(esClient.esql.query).toHaveBeenCalledWith({
      query: 'FROM index-a | STATS oldest_incompatible_doc = MIN(@timestamp)',
      params: [],
    });
    expect(metadata?.oldestIncompatibleDocTimestamp).toBe(Date.parse('2024-01-02T03:04:05.678Z'));
  });

  it('continues without a timestamp when the query fails', async () => {
    esClient.esql.query.mockRejectedValue(new Error('no @timestamp'));

    const metadata = await getMetadata();

    expect(metadata?.oldestIncompatibleDocTimestamp).toBeUndefined();
    expect(metadata?.indicesRequiringUpgradeDocsCount).toBe(2);
  });
});
