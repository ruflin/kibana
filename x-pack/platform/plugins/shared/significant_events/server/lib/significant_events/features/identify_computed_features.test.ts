/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { Logger } from '@kbn/logging';
import type { Streams } from '@kbn/streams-schema';
import { generateAllComputedFeatures } from '@kbn/streams-ai';
import type { KnowledgeIndicatorClient } from '../../knowledge_indicators';
import { identifyComputedFeatures } from './identify_computed_features';
import { persistExtractionCycleHeartbeat } from './persist_extraction_cycle';

jest.mock('@kbn/streams-ai', () => ({
  generateAllComputedFeatures: jest.fn(),
  CODE_ANALYSIS_PROVIDER_KEY: 'code_analysis',
}));

jest.mock('./persist_extraction_cycle', () => ({
  persistExtractionCycleHeartbeat: jest.fn(),
}));

const generateAllComputedFeaturesMock = jest.mocked(generateAllComputedFeatures);
const persistExtractionCycleHeartbeatMock = jest.mocked(persistExtractionCycleHeartbeat);

describe('identifyComputedFeatures', () => {
  const kiClient = {
    getDefaultExpiresAt: jest.fn().mockReturnValue('2026-09-30T00:00:00.000Z'),
    bulk: jest.fn().mockResolvedValue({ applied: 1, skipped: 0 }),
  } as unknown as KnowledgeIndicatorClient;

  const options = {
    stream: { name: 'logs.app' } as Streams.all.Definition,
    streamName: 'logs.app',
    start: 0,
    end: 1,
    esClient: {} as ElasticsearchClient,
    kiClient,
    logger: { get: () => ({ warn: jest.fn() }) } as unknown as Logger,
    runId: 'run-1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    persistExtractionCycleHeartbeatMock.mockResolvedValue(undefined);
    generateAllComputedFeaturesMock.mockResolvedValue({ features: [], errors: [] });
  });

  it('stamps the extraction-cycle heartbeat before running generators', async () => {
    const order: string[] = [];
    persistExtractionCycleHeartbeatMock.mockImplementation(async () => {
      order.push('heartbeat');
    });
    generateAllComputedFeaturesMock.mockImplementation(async () => {
      order.push('generate');
      return { features: [], errors: [] };
    });

    await identifyComputedFeatures(options);

    expect(order).toEqual(['heartbeat', 'generate']);
    expect(persistExtractionCycleHeartbeatMock).toHaveBeenCalledWith({
      kiClient,
      streamName: 'logs.app',
      runId: 'run-1',
    });
  });

  it('still returns generator errors after a successful heartbeat stamp', async () => {
    generateAllComputedFeaturesMock.mockResolvedValue({
      features: [],
      errors: [{ feature: 'error_logs', error: 'boom' }],
    });

    const result = await identifyComputedFeatures(options);

    expect(persistExtractionCycleHeartbeatMock).toHaveBeenCalled();
    expect(result.errors).toEqual([{ feature: 'error_logs', error: 'boom' }]);
  });
});
