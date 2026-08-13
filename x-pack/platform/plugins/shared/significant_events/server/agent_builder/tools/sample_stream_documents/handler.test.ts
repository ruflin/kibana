/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { DEFAULT_SIGNIFICANT_EVENTS_TUNING_CONFIG } from '@kbn/significant-events-schema';
import { sampleStreamDocumentsToolHandler } from './handler';
import { fetchSampleDocuments } from '../../../lib/significant_events/features/fetch_sample_documents';

jest.mock('../../../lib/significant_events/features/fetch_sample_documents', () => ({
  fetchSampleDocuments: jest.fn(),
}));

const fetchSampleDocumentsMock = fetchSampleDocuments as jest.MockedFunction<
  typeof fetchSampleDocuments
>;

describe('sampleStreamDocumentsToolHandler', () => {
  const logger = loggingSystemMock.createLogger();
  const stream = {
    name: 'logs.test',
    description: '',
    ingest: {
      classic: { field_overrides: {} },
      processing: { steps: [] },
      wired: undefined,
      lifecycle: { inherit: {} },
      failure_store: { inherit: {} },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('samples documents and formats hits', async () => {
    fetchSampleDocumentsMock.mockResolvedValue({
      documents: [
        {
          _index: 'logs.test',
          _id: 'doc-1',
          _source: { 'service.name': 'checkout', tags: ['a', 'b'] },
        },
      ],
      totalFilters: 0,
      filtersCapped: false,
      hasFilteredDocuments: false,
    });

    const kiClient = {
      getFeatures: jest.fn().mockResolvedValue({ hits: [] }),
    };

    const result = await sampleStreamDocumentsToolHandler({
      kiClient: kiClient as never,
      samplingEsClient: {} as never,
      stream: stream as never,
      tuningConfig: DEFAULT_SIGNIFICANT_EVENTS_TUNING_CONFIG,
      params: { streamName: 'logs.test', runId: 'run-1', iteration: 1 },
      logger,
    });

    expect(result.hasDocuments).toBe(true);
    expect(result.docsCount).toBe(1);
    expect(result.documents[0]).toEqual(
      expect.objectContaining({
        _id: 'doc-1',
      })
    );
    expect(fetchSampleDocumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        size: DEFAULT_SIGNIFICANT_EVENTS_TUNING_CONFIG.sample_size,
        iteration: 1,
        features: [],
      })
    );
  });

  it('returns hasDocuments false when sampling is empty', async () => {
    fetchSampleDocumentsMock.mockResolvedValue({
      documents: [],
      totalFilters: 0,
      filtersCapped: false,
      hasFilteredDocuments: false,
    });

    const result = await sampleStreamDocumentsToolHandler({
      kiClient: { getFeatures: jest.fn().mockResolvedValue({ hits: [] }) } as never,
      samplingEsClient: {} as never,
      stream: stream as never,
      tuningConfig: DEFAULT_SIGNIFICANT_EVENTS_TUNING_CONFIG,
      params: { streamName: 'logs.test' },
      logger,
    });

    expect(result).toEqual(
      expect.objectContaining({
        hasDocuments: false,
        docsCount: 0,
        documents: [],
      })
    );
  });
});
