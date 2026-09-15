/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

jest.mock('@kbn/inference-prompt-utils', () => ({
  executeAsReasoningAgent: jest.fn(),
}));

import type { Logger } from '@kbn/logging';
import type { BoundInferenceClient } from '@kbn/inference-common';
import { executeAsReasoningAgent } from '@kbn/inference-prompt-utils';
import { computeFeatureUuid, type Feature } from '@kbn/significant-events-schema';
import { generateTopologyFromKnowledgeIndicators } from './generate_topology_from_knowledge_indicators';

const executeAsReasoningAgentMock = executeAsReasoningAgent as jest.MockedFunction<
  typeof executeAsReasoningAgent
>;

function makeFeature(overrides: Partial<Feature> & Pick<Feature, 'id' | 'type'>): Feature {
  const base = {
    stream_name: 'logs.claims',
    description: `${overrides.type} ${overrides.id}`,
    properties: { name: overrides.id },
    confidence: 80,
    ...overrides,
  };
  return {
    ...base,
    uuid: overrides.uuid ?? computeFeatureUuid(base),
  };
}

const createReasoningResponse = (arguments_: Record<string, unknown>) =>
  ({
    content: '',
    toolCalls: [
      {
        toolCallId: 'call-finalize_topology',
        function: {
          name: 'finalize_topology',
          arguments: arguments_,
        },
      },
    ],
    tokens: { prompt: 10, completion: 5, total: 15 },
  } as unknown as Awaited<ReturnType<typeof executeAsReasoningAgent>>);

describe('generateTopologyFromKnowledgeIndicators', () => {
  const logger = { warn: jest.fn() } as unknown as Logger;
  const inferenceClient = {} as BoundInferenceClient;
  const signal = new AbortController().signal;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns topology features supported by existing knowledge indicators', async () => {
    executeAsReasoningAgentMock.mockResolvedValue(
      createReasoningResponse({
        features: [
          {
            id: 'entity-payments',
            stream_name: 'logs.claims',
            type: 'entity',
            subtype: 'service',
            title: 'payments',
            description: 'Payments service implied by schema',
            properties: { name: 'payments' },
            confidence: 70,
            evidence: ['schema mentions payments'],
            tags: ['topology'],
          },
          {
            id: 'schema-should-drop',
            stream_name: 'logs.claims',
            type: 'schema',
            subtype: 'fields',
            title: 'schema',
            description: 'should be dropped',
            properties: { name: 'schema' },
            confidence: 70,
            evidence: [],
            tags: [],
          },
          {
            id: 'other-stream',
            stream_name: 'logs.other',
            type: 'entity',
            subtype: 'service',
            title: 'other',
            description: 'wrong stream',
            properties: { name: 'other' },
            confidence: 70,
            evidence: [],
            tags: [],
          },
        ],
      })
    );

    const result = await generateTopologyFromKnowledgeIndicators({
      features: [makeFeature({ id: 'schema-claims', type: 'schema' })],
      inferenceClient,
      logger,
      signal,
    });

    expect(result).toEqual([
      expect.objectContaining({
        id: 'entity-payments',
        type: 'entity',
        stream_name: 'logs.claims',
      }),
    ]);
  });

  it('throws when finalize_topology is not called', async () => {
    executeAsReasoningAgentMock.mockResolvedValue({
      content: '',
      toolCalls: [],
      tokens: { prompt: 1, completion: 1, total: 2 },
    } as unknown as Awaited<ReturnType<typeof executeAsReasoningAgent>>);

    await expect(
      generateTopologyFromKnowledgeIndicators({
        features: [makeFeature({ id: 'schema-claims', type: 'schema' })],
        inferenceClient,
        logger,
        signal,
      })
    ).rejects.toThrow('Topology generation did not call finalize_topology');
  });
});
