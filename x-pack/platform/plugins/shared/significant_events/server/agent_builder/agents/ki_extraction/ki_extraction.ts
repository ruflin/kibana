/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AgentBuilderPluginSetup } from '@kbn/agent-builder-server';
import type { AgentTypeDefinition } from '@kbn/agent-builder-server/agents';
import { platformSignificantEventsTools, platformCoreTools } from '@kbn/agent-builder-common/tools';
import { featuresPrompt } from '@kbn/streams-ai';
import { SIGNIFICANT_EVENTS_KI_GROUNDING_SKILL_ID } from '../../skills/significant_events_ki_grounding';
import { remapPromptToolNames } from '../remap_prompt_tool_names';

export const SIGNIFICANT_EVENTS_KI_EXTRACTION_AGENT_ID = 'significant-events.ki-extraction';
export const SIGNIFICANT_EVENTS_KI_EXTRACTION_AGENT_TYPE_ID =
  'platform.sig_events.ki-extraction-type';

const AGENT_LOOP_INSTRUCTIONS = `You run unattended as a workflow step that extracts Knowledge Indicator (KI) features for one stream.

## Extraction loop

Sample documents yourself. Do not wait for \`sample_documents\` in the user message.

1. Call \`${platformSignificantEventsTools.sampleStreamDocuments}\` for the stream (start at iteration 1; pass \`run_id\`, window, and sample knobs from the user message).
2. If \`hasDocuments\` is false, stop sampling.
3. Before inventing ids, search similar features with \`${platformSignificantEventsTools.searchKnowledgeIndicators}\` (\`kind: ["feature"]\`, \`stream_names: [<stream>]\`). Reuse a returned id only when it is the same real-world thing with the same type.
4. Persist the current sample's features with \`${platformSignificantEventsTools.persistFeatures}\` using the message \`run_id\`. Do not re-emit previously identified features as new inventory.
5. Repeat with \`iteration += 1\` until \`maxIterations\` or \`convergencePatience\` consecutive successful samples with zero new features.
6. Return structured output \`discoveredFeatures\` from the latest persist result (id + title of features persisted in this run). Empty is valid when nothing new was found.

Do not call \`finalize_features\`. Persist via \`${platformSignificantEventsTools.persistFeatures}\` instead.

`;

export const buildKiExtractionAgentInstructions = (): string => {
  return `${AGENT_LOOP_INSTRUCTIONS}${remapPromptToolNames(featuresPrompt, [
    ['search_similar_features', platformSignificantEventsTools.searchKnowledgeIndicators],
    ['finalize_features', platformSignificantEventsTools.persistFeatures],
  ])}`;
};

export const kiExtractionAgentType = {
  id: SIGNIFICANT_EVENTS_KI_EXTRACTION_AGENT_TYPE_ID,
  name: 'KI Feature Extractor',
  description:
    'Samples stream documents, extracts Knowledge Indicator features, reconciles them against existing features, and persists the results.',
  avatar_icon: 'logoElastic',
  baseConfiguration: {
    instructions: buildKiExtractionAgentInstructions(),
    skill_ids: [SIGNIFICANT_EVENTS_KI_GROUNDING_SKILL_ID, 'significant-events-memory'],
    enable_elastic_capabilities: false,
    connector_ids: [],
    tools: [
      {
        tool_ids: [
          platformCoreTools.executeEsql,
          platformSignificantEventsTools.searchKnowledgeIndicators,
          platformSignificantEventsTools.searchEvent,
          platformSignificantEventsTools.sampleStreamDocuments,
          platformSignificantEventsTools.persistFeatures,
        ],
      },
    ],
  },
} as const satisfies AgentTypeDefinition;

export const registerKiExtractionAgentType = (agentBuilder: AgentBuilderPluginSetup): void => {
  agentBuilder.agents.registerType(kiExtractionAgentType);
};
