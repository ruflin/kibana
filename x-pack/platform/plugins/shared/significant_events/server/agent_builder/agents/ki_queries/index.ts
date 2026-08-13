/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AgentBuilderPluginSetup } from '@kbn/agent-builder-server';
import { registerKiQueriesAgentType } from './ki_queries';

export {
  SIGNIFICANT_EVENTS_KI_QUERIES_AGENT_ID,
  SIGNIFICANT_EVENTS_KI_QUERIES_AGENT_TYPE_ID,
  kiQueriesAgentType,
  registerKiQueriesAgentType,
  buildKiQueriesAgentInstructions,
} from './ki_queries';
export { installKiQueriesAgent } from './install_ki_queries_agent';

export const registerSignificantEventsKiQueriesAgentType = ({
  agentBuilder,
}: {
  agentBuilder: AgentBuilderPluginSetup;
}): void => {
  registerKiQueriesAgentType(agentBuilder);
};
