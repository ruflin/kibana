/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { SavedObjectsClientContract } from '@kbn/core-saved-objects-api-server';
import type { Logger } from '@kbn/logging';
import type { BoundInferenceClient } from '@kbn/inference-common';
import { fetchSampleDocuments } from '../../tasks/task_definitions/features_identification/fetch_sample_documents';
import { PromptsConfigService } from '../saved_objects/prompts_config_service';
import type { FeatureClient } from '../../streams/feature/feature_client';
import { identifyInferredFeatures } from './identify_inferred_features';

jest.mock('../../tasks/task_definitions/features_identification/fetch_sample_documents');
jest.mock('../saved_objects/prompts_config_service');

const fetchSampleDocumentsMock = jest.mocked(fetchSampleDocuments);
const PromptsConfigServiceMock = jest.mocked(PromptsConfigService);

const logger = {
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

const featureClient = {
  getFeatures: jest.fn().mockResolvedValue({ hits: [] }),
  getExcludedFeatures: jest.fn().mockResolvedValue({ hits: [] }),
  bulk: jest.fn().mockResolvedValue(undefined),
} as unknown as FeatureClient;

const baseOptions = () => ({
  esClient: {} as ElasticsearchClient,
  featureClient,
  soClient: {} as SavedObjectsClientContract,
  inferenceClient: {} as BoundInferenceClient,
  logger,
  signal: new AbortController().signal,
  streamType: 'wired' as const,
  start: 0,
  end: 1,
  runId: 'run-1',
});

describe('identifyInferredFeatures', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PromptsConfigServiceMock.mockImplementation(
      () =>
        ({
          getPrompt: jest.fn().mockResolvedValue({ featurePromptOverride: 'prompt' }),
        } as unknown as PromptsConfigService)
    );
    // No documents → short-circuits before LLM inference, which keeps the test
    // focused on the sampling source without mocking @kbn/streams-ai.
    fetchSampleDocumentsMock.mockResolvedValue({
      documents: [],
      totalFilters: 0,
      filtersCapped: false,
      hasFilteredDocuments: false,
      nextOffset: 0,
    });
  });

  it('samples a query stream from its ES|QL view in view metadata mode', async () => {
    await identifyInferredFeatures({
      ...baseOptions(),
      streamName: 'foobar',
      streamType: 'query',
      sampleSource: '$.foobar',
    });

    expect(fetchSampleDocumentsMock).toHaveBeenCalledTimes(1);
    expect(fetchSampleDocumentsMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ index: '$.foobar', metadataMode: 'view' })
    );
  });

  it('defaults the sampling source to the stream name and uses index metadata mode for ingest streams', async () => {
    await identifyInferredFeatures({
      ...baseOptions(),
      streamName: 'logs.test-default',
    });

    expect(fetchSampleDocumentsMock).toHaveBeenCalledTimes(1);
    expect(fetchSampleDocumentsMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ index: 'logs.test-default', metadataMode: 'index' })
    );
  });
});
