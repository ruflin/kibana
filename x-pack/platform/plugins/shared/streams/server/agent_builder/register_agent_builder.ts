/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AgentBuilderPluginSetup } from '@kbn/agent-builder-plugin/server';
import type { Logger } from '@kbn/logging';
import { createSigDiscoveryAgentDefinition } from './agents/sig_discovery_agent';
import { generateDiscoveriesSkill } from './skills/generate_discoveries_skill';
import { extractStreamFeaturesSkill } from './skills/extract_stream_features_skill';
import { generateSigEventsQueriesSkill } from './skills/generate_sig_events_queries_skill';
import { generateSuggestionsSkill } from './skills/generate_suggestions_skill';
import { pushEntityDefinitionSkill } from './skills/push_entity_definition_skill';
import { registerTools } from './tools/register_tools';
import type { StreamsToolsDependencies } from './tools/types';

export const registerAgentBuilder = (
  agentBuilder: AgentBuilderPluginSetup,
  logger: Logger,
  toolsDeps: StreamsToolsDependencies
): void => {
  registerTools(agentBuilder, toolsDeps);

  agentBuilder.agents.register(createSigDiscoveryAgentDefinition());

  agentBuilder.skills.register(generateDiscoveriesSkill);
  agentBuilder.skills.register(extractStreamFeaturesSkill);
  agentBuilder.skills.register(generateSigEventsQueriesSkill);
  agentBuilder.skills.register(generateSuggestionsSkill);
  agentBuilder.skills.register(pushEntityDefinitionSkill);

  logger.debug(
    'Successfully registered SigDiscovery agent, 5 skills, and 11 tools in Agent Builder'
  );
};
