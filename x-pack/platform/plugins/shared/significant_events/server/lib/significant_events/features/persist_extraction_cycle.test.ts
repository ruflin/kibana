/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EXTRACTION_CYCLE_FEATURE_TYPE } from '@kbn/significant-events-schema';
import type { KnowledgeIndicatorClient } from '../../knowledge_indicators';
import {
  createExtractionCycleHeartbeat,
  persistExtractionCycleHeartbeat,
} from './persist_extraction_cycle';

describe('createExtractionCycleHeartbeat', () => {
  it('builds an expiring computed-shaped feature keyed by type', () => {
    const feature = createExtractionCycleHeartbeat({
      streamName: 'logs.app',
      runId: 'run-1',
      expiresAt: '2026-09-30T00:00:00.000Z',
    });

    expect(feature).toEqual({
      id: EXTRACTION_CYCLE_FEATURE_TYPE,
      stream_name: 'logs.app',
      type: EXTRACTION_CYCLE_FEATURE_TYPE,
      description: expect.any(String),
      properties: {},
      confidence: 100,
      run_id: 'run-1',
      expires_at: '2026-09-30T00:00:00.000Z',
    });
    expect(feature.expires_at).toBeDefined();
  });
});

describe('persistExtractionCycleHeartbeat', () => {
  it('indexes the heartbeat with the client default TTL', async () => {
    const kiClient = {
      getDefaultExpiresAt: jest.fn().mockReturnValue('2026-09-30T00:00:00.000Z'),
      bulk: jest.fn().mockResolvedValue({ applied: 1, skipped: 0 }),
    } as unknown as KnowledgeIndicatorClient;

    await persistExtractionCycleHeartbeat({
      kiClient,
      streamName: 'logs.app',
      runId: 'run-1',
    });

    expect(kiClient.bulk).toHaveBeenCalledWith('logs.app', [
      {
        index: {
          feature: createExtractionCycleHeartbeat({
            streamName: 'logs.app',
            runId: 'run-1',
            expiresAt: '2026-09-30T00:00:00.000Z',
          }),
        },
      },
    ]);
  });
});
