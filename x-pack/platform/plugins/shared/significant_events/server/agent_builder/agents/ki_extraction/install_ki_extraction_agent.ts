/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AgentAccessControlMode } from '@kbn/agent-builder-common';
import type { AgentBuilderPluginStart } from '@kbn/agent-builder-server';
import type { AgentAvailabilityConfig } from '@kbn/agent-builder-server/agents';
import {
  SIGNIFICANT_EVENTS_KI_EXTRACTION_AGENT_ID,
  SIGNIFICANT_EVENTS_KI_EXTRACTION_AGENT_TYPE_ID,
  kiExtractionAgentType,
} from './ki_extraction';

/**
 * Installs the system-owned, user-editable KI feature-extraction agent profile.
 * Idempotent — does not overwrite existing agents or later user edits.
 */
export const installKiExtractionAgent = async ({
  agentBuilder,
  spaceId,
  availability,
}: {
  agentBuilder: AgentBuilderPluginStart;
  spaceId: string;
  availability?: AgentAvailabilityConfig;
}): Promise<void> => {
  await agentBuilder.agents.ensure({
    spaceId,
    availability,
    agent: {
      id: SIGNIFICANT_EVENTS_KI_EXTRACTION_AGENT_ID,
      type: SIGNIFICANT_EVENTS_KI_EXTRACTION_AGENT_TYPE_ID,
      name: 'KI Feature Extractor',
      description: kiExtractionAgentType.description,
      labels: ['observability', 'streams', 'significant-events', 'ki-extraction'],
      avatar_symbol: 'KE',
      access_control: { access_mode: AgentAccessControlMode.Public },
      configuration: {
        tools: [],
        skill_ids: [],
        connector_ids: [],
      },
    },
  });
};
