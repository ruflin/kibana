/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import { loggerMock } from '@kbn/logging-mocks';
import { computeFeatureUuid } from '@kbn/significant-events-schema';
import type { StoredFeatureKnowledgeIndicator } from '../data_stream';
import { KI_TYPE_FEATURE } from '../fields';
import { createAiIndexWriter } from './ai_index_writer';
import { NIGHTSHIFT_AI_INDEX_DEST } from './constants';

const STREAM = 'logs-app';

const createFeatureDoc = (): StoredFeatureKnowledgeIndicator => ({
  '@timestamp': '2026-01-01T00:00:00.000Z',
  id: computeFeatureUuid({ id: 'checkout', stream_name: STREAM }),
  type: KI_TYPE_FEATURE,
  'stream.name': STREAM,
  title: 'Checkout',
  description: 'Checkout service',
  feature: {
    slug: 'checkout',
    type: 'entity',
    properties: {},
    confidence: 90,
  },
});

describe('createAiIndexWriter', () => {
  it('creates the dest then bulk-upserts mapped documents', async () => {
    const bulk = jest.fn().mockResolvedValue({ errors: false, items: [] });
    const create = jest.fn().mockResolvedValue({});
    const esClient = {
      bulk,
      indices: { create },
    } as unknown as ElasticsearchClient;
    const logger = loggerMock.create();

    const writer = createAiIndexWriter({ esClient, logger });
    await writer.project([createFeatureDoc()]);

    expect(create).toHaveBeenCalledWith({ index: NIGHTSHIFT_AI_INDEX_DEST }, { ignore: [400] });
    expect(bulk).toHaveBeenCalledTimes(1);
    const { operations } = bulk.mock.calls[0][0];
    expect(operations[0]).toEqual({
      index: { _index: NIGHTSHIFT_AI_INDEX_DEST, _id: 'logs-app/checkout' },
    });
    expect(operations[1]).toEqual(
      expect.objectContaining({
        type: 'feature',
        id: 'logs-app/checkout',
      })
    );
  });

  it('bulk-deletes by dest id', async () => {
    const bulk = jest.fn().mockResolvedValue({ errors: false, items: [] });
    const create = jest.fn().mockResolvedValue({});
    const esClient = {
      bulk,
      indices: { create },
    } as unknown as ElasticsearchClient;

    const writer = createAiIndexWriter({ esClient, logger: loggerMock.create() });
    await writer.projectDeletes([createFeatureDoc()]);

    const { operations } = bulk.mock.calls[0][0];
    expect(operations).toEqual([
      { delete: { _index: NIGHTSHIFT_AI_INDEX_DEST, _id: 'logs-app/checkout' } },
    ]);
  });

  it('does not write when the mapper emits no operations', async () => {
    const bulk = jest.fn();
    const create = jest.fn();
    const esClient = {
      bulk,
      indices: { create },
    } as unknown as ElasticsearchClient;

    const writer = createAiIndexWriter({ esClient, logger: loggerMock.create() });
    await writer.project([
      {
        '@timestamp': '2026-01-01T00:00:00.000Z',
        id: 'uuid-only',
        type: KI_TYPE_FEATURE,
        'stream.name': STREAM,
        deleted: true,
      },
    ]);

    expect(create).not.toHaveBeenCalled();
    expect(bulk).not.toHaveBeenCalled();
  });
});
