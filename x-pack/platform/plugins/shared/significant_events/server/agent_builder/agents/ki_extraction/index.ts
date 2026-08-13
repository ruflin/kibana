/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AgentBuilderPluginSetup } from '@kbn/agent-builder-server';
import { registerKiExtractionAgentType } from './ki_extraction';

export {
  SIGNIFICANT_EVENTS_KI_EXTRACTION_AGENT_ID,
  SIGNIFICANT_EVENTS_KI_EXTRACTION_AGENT_TYPE_ID,
  kiExtractionAgentType,
  registerKiExtractionAgentType,
  buildKiExtractionAgentInstructions,
} from './ki_extraction';
export { installKiExtractionAgent } from './install_ki_extraction_agent';

export const registerSignificantEventsKiExtractionAgentType = ({
  agentBuilder,
}: {
  agentBuilder: AgentBuilderPluginSetup;
}): void => {
  registerKiExtractionAgentType(agentBuilder);
};
