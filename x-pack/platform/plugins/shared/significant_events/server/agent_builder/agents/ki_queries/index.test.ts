/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { agentBuilderMocks } from '@kbn/agent-builder-plugin/server/mocks';
import { platformSignificantEventsTools } from '@kbn/agent-builder-common/tools';
import {
  buildKiQueriesAgentInstructions,
  kiQueriesAgentType,
  registerSignificantEventsKiQueriesAgentType,
  SIGNIFICANT_EVENTS_KI_QUERIES_AGENT_TYPE_ID,
} from '.';

describe('KI query-generation agent types', () => {
  it('registers the managed KI query-generation base configuration', () => {
    const agentBuilder = agentBuilderMocks.createSetup();

    registerSignificantEventsKiQueriesAgentType({ agentBuilder });

    expect(agentBuilder.agents.registerType).toHaveBeenCalledTimes(1);
    expect(agentBuilder.agents.registerType).toHaveBeenCalledWith(kiQueriesAgentType);
    expect(kiQueriesAgentType).toMatchObject({
      id: SIGNIFICANT_EVENTS_KI_QUERIES_AGENT_TYPE_ID,
      baseConfiguration: {
        enable_elastic_capabilities: false,
        connector_ids: [],
        skill_ids: ['significant-events-ki-grounding', 'significant-events-memory'],
      },
    });
    expect(kiQueriesAgentType.baseConfiguration.tools[0].tool_ids).toEqual(
      expect.arrayContaining([
        platformSignificantEventsTools.searchKnowledgeIndicators,
        platformSignificantEventsTools.validateKiQuery,
      ])
    );
  });

  it('interpolates mustache placeholders and points at Agent Builder tools', () => {
    const instructions = buildKiQueriesAgentInstructions();
    expect(instructions).toContain(platformSignificantEventsTools.searchKnowledgeIndicators);
    expect(instructions).toContain(platformSignificantEventsTools.validateKiQuery);
    expect(instructions).not.toContain('{{{available_feature_types}}}');
    expect(instructions).not.toContain('{{{computed_feature_instructions}}}');
  });
});
