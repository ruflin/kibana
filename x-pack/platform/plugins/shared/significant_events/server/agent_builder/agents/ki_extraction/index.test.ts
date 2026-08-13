/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { agentBuilderMocks } from '@kbn/agent-builder-plugin/server/mocks';
import { platformSignificantEventsTools } from '@kbn/agent-builder-common/tools';
import {
  buildKiExtractionAgentInstructions,
  kiExtractionAgentType,
  registerSignificantEventsKiExtractionAgentType,
  SIGNIFICANT_EVENTS_KI_EXTRACTION_AGENT_TYPE_ID,
} from '.';

describe('KI extraction agent types', () => {
  it('registers the managed KI extraction base configuration', () => {
    const agentBuilder = agentBuilderMocks.createSetup();

    registerSignificantEventsKiExtractionAgentType({ agentBuilder });

    expect(agentBuilder.agents.registerType).toHaveBeenCalledTimes(1);
    expect(agentBuilder.agents.registerType).toHaveBeenCalledWith(kiExtractionAgentType);
    expect(kiExtractionAgentType).toMatchObject({
      id: SIGNIFICANT_EVENTS_KI_EXTRACTION_AGENT_TYPE_ID,
      baseConfiguration: {
        enable_elastic_capabilities: false,
        connector_ids: [],
        skill_ids: ['significant-events-ki-grounding', 'significant-events-memory'],
      },
    });
    expect(kiExtractionAgentType.baseConfiguration.tools[0].tool_ids).toEqual(
      expect.arrayContaining([
        platformSignificantEventsTools.sampleStreamDocuments,
        platformSignificantEventsTools.persistFeatures,
        platformSignificantEventsTools.searchKnowledgeIndicators,
      ])
    );
  });

  it('describes the sampling loop and points at Agent Builder tools', () => {
    const instructions = buildKiExtractionAgentInstructions();
    expect(instructions).toContain(platformSignificantEventsTools.searchKnowledgeIndicators);
    expect(instructions).toContain(platformSignificantEventsTools.persistFeatures);
    expect(instructions).toContain(platformSignificantEventsTools.sampleStreamDocuments);
    expect(instructions).toContain('Extraction loop');
  });
});
