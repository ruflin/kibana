/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AgentBuilderPluginSetup } from '@kbn/agent-builder-plugin/server';
import type { Logger } from '@kbn/logging';
import { createSigDiscoveryAgentDefinition } from './agents/sig_discovery_agent';
import { createStreamSkills } from './skills/create_skills';
import { registerTools } from './tools/register_tools';
import type { StreamsToolsDependencies } from './tools/types';
import type { GetScopedClients } from '../routes/types';

export const registerAgentBuilder = (
  agentBuilder: AgentBuilderPluginSetup,
  logger: Logger,
  toolsDeps: StreamsToolsDependencies,
  getScopedClients: GetScopedClients
): void => {
  registerTools(agentBuilder, toolsDeps);

  agentBuilder.agents.register(createSigDiscoveryAgentDefinition());

  const skills = createStreamSkills({ getScopedClients, logger });
  for (const skill of skills) {
    agentBuilder.skills.register(skill);
  }

  logger.debug(
    `Successfully registered SigDiscovery agent, ${skills.length} skills, and tools in Agent Builder`
  );
};
