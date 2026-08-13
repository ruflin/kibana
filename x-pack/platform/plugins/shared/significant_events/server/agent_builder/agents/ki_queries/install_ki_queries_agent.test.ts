/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AgentAccessControlMode } from '@kbn/agent-builder-common';
import { agentBuilderMocks } from '@kbn/agent-builder-plugin/server/mocks';
import {
  SIGNIFICANT_EVENTS_KI_QUERIES_AGENT_ID,
  SIGNIFICANT_EVENTS_KI_QUERIES_AGENT_TYPE_ID,
  kiQueriesAgentType,
} from '.';
import { installKiQueriesAgent } from './install_ki_queries_agent';

describe('installKiQueriesAgent', () => {
  it('ensures a system-owned persisted typed agent in the requested space', async () => {
    const agentBuilder = agentBuilderMocks.createStart();
    const availability = { cacheMode: 'space' as const, handler: jest.fn() };

    await installKiQueriesAgent({ agentBuilder, spaceId: 'space-1', availability });

    expect(agentBuilder.agents.ensure).toHaveBeenCalledTimes(1);
    expect(agentBuilder.agents.ensure).toHaveBeenCalledWith({
      spaceId: 'space-1',
      availability,
      agent: {
        id: SIGNIFICANT_EVENTS_KI_QUERIES_AGENT_ID,
        type: SIGNIFICANT_EVENTS_KI_QUERIES_AGENT_TYPE_ID,
        name: 'KI Query Generator',
        description: kiQueriesAgentType.description,
        labels: ['observability', 'streams', 'significant-events', 'ki-queries'],
        avatar_symbol: 'KQ',
        access_control: { access_mode: AgentAccessControlMode.Public },
        configuration: {
          tools: [],
          skill_ids: [],
          connector_ids: [],
        },
      },
    });
  });
});
