/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { SIGNIFICANT_EVENTS_AI_INDEX_DEST } from '../../../common/constants';
import { ensureSignificantEventsAiIndexDest } from './ensure_dest';

describe('ensureSignificantEventsAiIndexDest', () => {
  const logger = loggingSystemMock.createLogger();

  it('creates the dest index when it does not exist', async () => {
    const esClient = {
      indices: {
        exists: jest.fn().mockResolvedValue(false),
        create: jest.fn().mockResolvedValue({ acknowledged: true }),
      },
    };

    await ensureSignificantEventsAiIndexDest({
      esClient: esClient as never,
      logger,
    });

    expect(esClient.indices.exists).toHaveBeenCalledWith({
      index: SIGNIFICANT_EVENTS_AI_INDEX_DEST,
    });
    expect(esClient.indices.create).toHaveBeenCalledWith({
      index: SIGNIFICANT_EVENTS_AI_INDEX_DEST,
    });
  });

  it('does not recreate an existing dest index', async () => {
    const esClient = {
      indices: {
        exists: jest.fn().mockResolvedValue(true),
        create: jest.fn(),
      },
    };

    await ensureSignificantEventsAiIndexDest({
      esClient: esClient as never,
      logger,
    });

    expect(esClient.indices.create).not.toHaveBeenCalled();
  });

  it('swallows create failures', async () => {
    const esClient = {
      indices: {
        exists: jest.fn().mockResolvedValue(false),
        create: jest.fn().mockRejectedValue(new Error('no template')),
      },
    };

    await expect(
      ensureSignificantEventsAiIndexDest({
        esClient: esClient as never,
        logger,
      })
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
