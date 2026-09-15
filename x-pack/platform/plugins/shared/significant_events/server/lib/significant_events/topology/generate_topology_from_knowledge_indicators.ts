/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/logging';
import type { BoundInferenceClient } from '@kbn/inference-common';
import { createPrompt } from '@kbn/inference-common';
import { executeAsReasoningAgent } from '@kbn/inference-prompt-utils';
import {
  identifiedFeatureSchema,
  isComputedFeature,
  type BaseFeature,
  type Feature,
} from '@kbn/significant-events-schema';
import { toFeatureForLlmContext } from '@kbn/nightshift-ai';
import { z } from '@kbn/zod/v4';
import { uniqBy } from 'lodash';
import { TOPOLOGY_FEATURE_TYPES } from './derive_implied_topology_features';

export const MAX_TOPOLOGY_FEATURES_FOR_PROMPT = 100;
export const MAX_GENERATED_TOPOLOGY_FEATURES = 100;

const TOPOLOGY_TYPE_SET = new Set<string>(TOPOLOGY_FEATURE_TYPES);

const topologyFeaturesSchema = {
  type: 'object',
  properties: {
    features: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'Stable identifier. Use a lowercase hyphenated slug scoped by type, e.g. entity-frontend or technology-java.',
          },
          stream_name: {
            type: 'string',
            description:
              'Must match stream_name of an existing knowledge indicator that supports this feature.',
          },
          type: {
            type: 'string',
            enum: ['entity', 'infrastructure', 'technology', 'dependency'],
          },
          subtype: { type: 'string' },
          description: { type: 'string' },
          title: { type: 'string' },
          properties: {
            type: 'object',
            properties: {},
            minProperties: 1,
            additionalProperties: true,
            description:
              'Identifying properties. Entities, technologies, and infrastructure need name. Dependencies need source and target (or from and to) that resolve to existing or newly returned nodes.',
          },
          confidence: { type: 'number', minimum: 0, maximum: 100 },
          evidence: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'id',
          'stream_name',
          'type',
          'subtype',
          'description',
          'title',
          'properties',
          'confidence',
          'evidence',
          'tags',
        ],
      },
    },
  },
  required: ['features'],
} as const;

const generateTopologyPrompt = createPrompt({
  name: 'generate_topology_from_knowledge_indicators',
  input: z.object({
    existing_knowledge_indicators: z.string(),
  }),
})
  .version({
    system: {
      mustache: {
        template: `You generate system topology knowledge indicators from existing knowledge indicators.

Do not run feature identification against raw documents. Do not onboard streams. Use only the provided knowledge indicators as the source of truth.

Return entity, technology, infrastructure, and dependency features that those knowledge indicators already imply. Fill relationship gaps: missing technology or infrastructure nodes referenced by entities, unresolved dependency endpoints, and implied entity-to-technology or entity-to-infrastructure relationships.

Do not invent topology that existing knowledge indicators do not support. Do not return schema or computed feature types. Each feature stream_name must match an existing knowledge indicator.`,
      },
    },
    template: {
      mustache: {
        template: `existing_knowledge_indicators:
{{{existing_knowledge_indicators}}}`,
      },
    },
    tools: {
      finalize_topology: {
        description:
          'Return topology knowledge indicators implied by the existing knowledge indicators. Omit features that already exist unless you are filling a genuine gap with a new id.',
        schema: topologyFeaturesSchema,
      },
    },
  })
  .get();

const compactFeaturesForPrompt = (features: readonly Feature[]): string => {
  const topologyFirst = [
    ...features.filter((feature) => TOPOLOGY_TYPE_SET.has(feature.type)),
    ...features.filter(
      (feature) => !TOPOLOGY_TYPE_SET.has(feature.type) && !isComputedFeature(feature)
    ),
  ].slice(0, MAX_TOPOLOGY_FEATURES_FOR_PROMPT);

  return JSON.stringify(
    topologyFirst.map((feature) => ({
      stream_name: feature.stream_name,
      ...toFeatureForLlmContext(feature),
    }))
  );
};

export async function generateTopologyFromKnowledgeIndicators({
  features,
  inferenceClient,
  logger,
  signal,
}: {
  features: readonly Feature[];
  inferenceClient: BoundInferenceClient;
  logger: Logger;
  signal: AbortSignal;
}): Promise<BaseFeature[]> {
  const response = await executeAsReasoningAgent({
    input: {
      existing_knowledge_indicators: compactFeaturesForPrompt(features),
    },
    prompt: generateTopologyPrompt,
    inferenceClient,
    maxSteps: 4,
    toolCallbacks: {
      finalize_topology: async () => ({ response: { finalized: true } }),
    },
    finalToolChoice: {
      type: 'function',
      function: 'finalize_topology',
    },
    abortSignal: signal,
  });

  if (response.toolCalls.length === 0) {
    throw new Error('Topology generation did not call finalize_topology');
  }

  const knownStreamNames = new Set(features.map((feature) => feature.stream_name));
  const finalized: BaseFeature[] = [];

  for (const toolCall of response.toolCalls) {
    const { features: rawFeatures } = toolCall.function.arguments;
    if (!Array.isArray(rawFeatures)) {
      logger.warn('Topology generation returned invalid finalize_topology output');
      continue;
    }

    for (const item of rawFeatures) {
      const result = identifiedFeatureSchema.safeParse(item);
      if (!result.success || Object.keys(result.data.properties).length === 0) {
        continue;
      }
      if (!TOPOLOGY_TYPE_SET.has(result.data.type)) {
        continue;
      }
      if (!knownStreamNames.has(result.data.stream_name)) {
        continue;
      }
      finalized.push(result.data);
    }
  }

  return uniqBy(finalized, (feature) => `${feature.stream_name}:${feature.id}`).slice(
    0,
    MAX_GENERATED_TOPOLOGY_FEATURES
  );
}
