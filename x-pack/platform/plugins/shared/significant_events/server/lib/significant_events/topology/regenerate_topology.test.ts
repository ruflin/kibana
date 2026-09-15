/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/logging';
import type { InferenceClient } from '@kbn/inference-common';
import { computeFeatureUuid, type Feature } from '@kbn/significant-events-schema';
import { regenerateTopology } from './regenerate_topology';

const mockGenerateTopologyFromKnowledgeIndicators = jest.fn();

jest.mock('./generate_topology_from_knowledge_indicators', () => ({
  generateTopologyFromKnowledgeIndicators: (...args: unknown[]) =>
    mockGenerateTopologyFromKnowledgeIndicators(...args),
}));

function makeFeature(overrides: Partial<Feature> & Pick<Feature, 'id' | 'type'>): Feature {
  const base = {
    stream_name: 'logs.claims',
    description: `${overrides.type} ${overrides.id}`,
    properties: {},
    confidence: 90,
    ...overrides,
  };
  return {
    ...base,
    uuid: overrides.uuid ?? computeFeatureUuid(base),
  };
}

describe('regenerateTopology', () => {
  const logger = { debug: jest.fn(), warn: jest.fn() } as unknown as Logger;
  const signal = new AbortController().signal;
  const boundClient = {};
  const inferenceClient = {
    bindTo: jest.fn().mockReturnValue(boundClient),
  } as unknown as InferenceClient;

  const makeKiClient = (features: Feature[]) => ({
    getFeatures: jest.fn().mockResolvedValue({ hits: features }),
    getDefaultExpiresAt: jest.fn().mockReturnValue('2099-01-01T00:00:00.000Z'),
    bulk: jest.fn().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateTopologyFromKnowledgeIndicators.mockResolvedValue([]);
  });

  it('writes implied topology knowledge indicators and skips LLM duplicates', async () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      title: 'frontend',
      properties: { name: 'frontend', technology: 'java' },
    });
    const kiClient = makeKiClient([frontend]);
    mockGenerateTopologyFromKnowledgeIndicators.mockResolvedValue([
      {
        id: 'technology-java',
        stream_name: 'logs.claims',
        type: 'technology',
        subtype: 'runtime',
        title: 'java',
        description: 'duplicate of implied',
        properties: { name: 'java' },
        confidence: 70,
        evidence: [],
        tags: [],
      },
    ]);

    const result = await regenerateTopology({
      requestedStreamNames: ['logs.claims'],
      connectorId: 'connector-1',
      kiClient: kiClient as never,
      listStreamNames: async () => ['logs.claims', 'logs.payments'],
      inferenceClient,
      logger,
      signal,
    });

    expect(kiClient.getFeatures).toHaveBeenCalledWith(['logs.claims']);
    expect(mockGenerateTopologyFromKnowledgeIndicators).toHaveBeenCalledWith(
      expect.objectContaining({
        features: [frontend],
        inferenceClient: boundClient,
      })
    );
    expect(kiClient.bulk).toHaveBeenCalledTimes(1);
    const operations = kiClient.bulk.mock.calls[0][1] as Array<{
      index: { feature: { id: string; type: string } };
    }>;
    expect(operations.map((operation) => operation.index.feature.id).sort()).toEqual([
      'dependency-entity-frontend-technology-java',
      'technology-java',
    ]);
    expect(result).toEqual({
      streamNames: ['logs.claims'],
      createdCount: 2,
      connectorId: 'connector-1',
    });
  });

  it('does not write when the LLM call fails', async () => {
    const kiClient = makeKiClient([
      makeFeature({ id: 'entity-frontend', type: 'entity', properties: { name: 'frontend' } }),
    ]);
    mockGenerateTopologyFromKnowledgeIndicators.mockRejectedValue(new Error('llm down'));

    await expect(
      regenerateTopology({
        connectorId: 'connector-1',
        kiClient: kiClient as never,
        listStreamNames: async () => ['logs.claims'],
        inferenceClient,
        logger,
        signal,
      })
    ).rejects.toThrow('llm down');

    expect(kiClient.bulk).not.toHaveBeenCalled();
  });

  it('throws when no knowledge indicators exist in scope', async () => {
    const kiClient = makeKiClient([]);

    await expect(
      regenerateTopology({
        connectorId: 'connector-1',
        kiClient: kiClient as never,
        listStreamNames: async () => ['logs.claims'],
        inferenceClient,
        logger,
        signal,
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/No knowledge indicators were found/i),
        statusCode: 400,
      })
    );
    expect(kiClient.bulk).not.toHaveBeenCalled();
  });

  it('scopes requested stream names to accessible streams', async () => {
    const kiClient = makeKiClient([
      makeFeature({ id: 'schema-claims', type: 'schema', properties: { name: 'schema' } }),
    ]);

    await regenerateTopology({
      requestedStreamNames: ['logs.claims', 'logs.secret'],
      connectorId: 'connector-1',
      kiClient: kiClient as never,
      listStreamNames: async () => ['logs.claims'],
      inferenceClient,
      logger,
      signal,
    });

    expect(kiClient.getFeatures).toHaveBeenCalledWith(['logs.claims']);
  });
});
