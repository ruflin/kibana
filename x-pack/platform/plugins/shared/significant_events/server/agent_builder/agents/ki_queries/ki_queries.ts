/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AgentBuilderPluginSetup } from '@kbn/agent-builder-server';
import type { AgentTypeDefinition } from '@kbn/agent-builder-server/agents';
import { platformSignificantEventsTools, platformCoreTools } from '@kbn/agent-builder-common/tools';
import {
  getComputedFeatureInstructions,
  QUERY_GENERATION_EXCLUDED_FEATURE_TYPES,
  SIGNIFICANT_EVENTS_FEATURE_TOOL_TYPES,
  significantEventsPrompt,
} from '@kbn/streams-ai';
import { SIGNIFICANT_EVENTS_KI_GROUNDING_SKILL_ID } from '../../skills/significant_events_ki_grounding';
import { remapPromptToolNames } from '../remap_prompt_tool_names';

export const SIGNIFICANT_EVENTS_KI_QUERIES_AGENT_ID = 'significant-events.ki-queries';
export const SIGNIFICANT_EVENTS_KI_QUERIES_AGENT_TYPE_ID = 'platform.sig_events.ki-queries-type';

const AGENT_ADAPTER_INSTRUCTIONS = `You run unattended as a workflow step that generates Knowledge Indicator (KI) queries for one stream.

## Agent Builder tools

When the instructions below mention a prompt-local tool name, call the Agent Builder tool instead:
- \`get_stream_features\` → \`${platformSignificantEventsTools.searchKnowledgeIndicators}\` with \`kind: ["feature"]\` and \`stream_names: [<stream>]\`. Call this first.
- \`add_queries\` → \`${platformSignificantEventsTools.validateKiQuery}\`. Validate candidates here; do not persist them.
- Fetch existing queries with \`${platformSignificantEventsTools.searchKnowledgeIndicators}\` (\`kind: ["query"]\`) before proposing replacements.
- You may use \`${platformCoreTools.executeEsql}\` to inspect field values when features are insufficient.

Do not call \`complete()\`. After validating queries, return them in structured output:
- \`esql\` is an object \`{ "query": "<rewritten ES|QL>" }\` (not a bare string)
- \`features\` is \`[{ "id": "<feature id>", "run_id": "<optional>" }]\` from validation results
- Include only queries whose validation status was Added / valid: true

`;

export const buildKiQueriesAgentInstructions = (): string => {
  const interpolated = significantEventsPrompt
    .split('{{{available_feature_types}}}')
    .join(SIGNIFICANT_EVENTS_FEATURE_TOOL_TYPES.join(', '))
    .split('{{{computed_feature_instructions}}}')
    .join(getComputedFeatureInstructions(QUERY_GENERATION_EXCLUDED_FEATURE_TYPES));

  return `${AGENT_ADAPTER_INSTRUCTIONS}${remapPromptToolNames(interpolated, [
    ['get_stream_features', platformSignificantEventsTools.searchKnowledgeIndicators],
    ['add_queries', platformSignificantEventsTools.validateKiQuery],
  ])}`;
};

export const kiQueriesAgentType = {
  id: SIGNIFICANT_EVENTS_KI_QUERIES_AGENT_TYPE_ID,
  name: 'KI Query Generator',
  description:
    'Generates Knowledge Indicator ES|QL queries for a stream from stored features, validates syntax, and returns queries for the workflow to persist.',
  avatar_icon: 'logoElastic',
  baseConfiguration: {
    instructions: buildKiQueriesAgentInstructions(),
    skill_ids: [SIGNIFICANT_EVENTS_KI_GROUNDING_SKILL_ID, 'significant-events-memory'],
    enable_elastic_capabilities: false,
    connector_ids: [],
    tools: [
      {
        tool_ids: [
          platformCoreTools.executeEsql,
          platformSignificantEventsTools.searchKnowledgeIndicators,
          platformSignificantEventsTools.validateKiQuery,
        ],
      },
    ],
  },
} as const satisfies AgentTypeDefinition;

export const registerKiQueriesAgentType = (agentBuilder: AgentBuilderPluginSetup): void => {
  agentBuilder.agents.registerType(kiQueriesAgentType);
};
