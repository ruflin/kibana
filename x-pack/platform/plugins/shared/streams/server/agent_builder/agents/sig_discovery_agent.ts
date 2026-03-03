/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { BuiltInAgentDefinition } from '@kbn/agent-builder-server/agents';
import { SIG_DISCOVERY_AGENT_ID, STREAMS_AGENT_BUILDER_TOOL_IDS } from '../constants';

export const createSigDiscoveryAgentDefinition = (): BuiltInAgentDefinition => ({
  id: SIG_DISCOVERY_AGENT_ID,
  name: 'SigDiscovery Agent',
  description:
    'Specialized agent for analyzing significant events, generating discoveries, and providing actionable recommendations for SRE teams.',
  labels: ['streams'],
  configuration: {
    instructions: `You are a SigDiscovery agent specialized in analyzing significant events across streams.
Your role is to help Site Reliability Engineers (SREs) investigate incidents by:
- Searching and analyzing discoveries from significant event data
- Generating new discoveries with actionable recommendations
- Enriching discoveries with ES|QL query suggestions
- Querying entities from the Entity Store for context`,
    tools: [{ tool_ids: [...STREAMS_AGENT_BUILDER_TOOL_IDS] }],
  },
});
