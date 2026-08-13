/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { validateKiQueryToolHandler } from './handler';

jest.mock('@kbn/streams-ai', () => ({
  computeValidationLookback: jest.fn().mockResolvedValue('now-10m'),
  DEFAULT_QUERY_VALIDATION_TIMEOUT_MS: 10_000,
}));

jest.mock('@kbn/streams-schema', () => ({
  deriveQueryType: jest.fn().mockReturnValue('match'),
  getSourcesForStream: jest.fn().mockReturnValue(['logs.test']),
  getStatsQueryHints: jest.fn().mockReturnValue([]),
  normalizeEsqlSafe: jest.fn((esql: string) => esql),
  replaceFromSources: jest.fn((esql: string) => esql),
}));

describe('validateKiQueryToolHandler', () => {
  const logger = loggingSystemMock.createLogger();
  const stream = { name: 'logs.test' };
  const query = {
    esql: 'FROM logs.test | WHERE error.message IS NOT NULL',
    title: 'Errors',
    description: 'Detects errors',
    category: 'error',
    severity_score: 60,
    feature_ids: ['dataset-analysis'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('validates a well-formed query', async () => {
    const esClient = {
      esql: { query: jest.fn().mockResolvedValue({}) },
    };
    const kiClient = {
      getFeatures: jest
        .fn()
        .mockResolvedValue({ hits: [{ id: 'dataset-analysis', run_id: 'run-1' }] }),
      getStreamToQueryLinksMap: jest.fn().mockResolvedValue({ 'logs.test': [] }),
    };

    const result = await validateKiQueryToolHandler({
      kiClient: kiClient as never,
      esClient: esClient as never,
      stream: stream as never,
      queries: [query],
      signal: new AbortController().signal,
      logger,
    });

    expect(result.queries).toHaveLength(1);
    expect(result.queries[0]).toEqual(
      expect.objectContaining({
        valid: true,
        status: 'Added',
        features: [{ id: 'dataset-analysis', run_id: 'run-1' }],
      })
    );
    expect(esClient.esql.query).toHaveBeenCalled();
  });

  it('rejects queries whose feature_ids are unknown', async () => {
    const result = await validateKiQueryToolHandler({
      kiClient: {
        getFeatures: jest.fn().mockResolvedValue({ hits: [] }),
        getStreamToQueryLinksMap: jest.fn().mockResolvedValue({ 'logs.test': [] }),
      } as never,
      esClient: { esql: { query: jest.fn() } } as never,
      stream: stream as never,
      queries: [query],
      signal: new AbortController().signal,
      logger,
    });

    expect(result.queries[0]).toEqual(
      expect.objectContaining({
        valid: false,
        status: 'Failed to add',
      })
    );
  });

  it('rejects duplicate ES|QL', async () => {
    const result = await validateKiQueryToolHandler({
      kiClient: {
        getFeatures: jest.fn().mockResolvedValue({ hits: [{ id: 'dataset-analysis' }] }),
        getStreamToQueryLinksMap: jest.fn().mockResolvedValue({
          'logs.test': [{ query: { esql: { query: query.esql } } }],
        }),
      } as never,
      esClient: { esql: { query: jest.fn() } } as never,
      stream: stream as never,
      queries: [query],
      signal: new AbortController().signal,
      logger,
    });

    expect(result.queries[0]).toEqual(
      expect.objectContaining({
        valid: false,
        status: 'Duplicate',
      })
    );
  });
});
