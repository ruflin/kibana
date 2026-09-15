/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { GenerateTopologyButton } from './generate_topology_button';
import { GENERATE_TOPOLOGY_INITIAL_MESSAGE } from './translations';

const mockOpenChat = jest.fn();
let mockAgentBuilder: { openChat: typeof mockOpenChat } | undefined = { openChat: mockOpenChat };
let mockBlocksActivity = false;
let mockActivityBlockTooltip: string | undefined;

jest.mock('../../../../hooks/use_kibana', () => ({
  useKibana: () => ({
    dependencies: {
      start: {
        agentBuilder: mockAgentBuilder,
      },
    },
  }),
}));

jest.mock('../../../../hooks/use_significant_events_maintenance', () => ({
  useBlocksNewActivity: () => ({
    blocksActivity: mockBlocksActivity,
    activityBlockTooltip: mockActivityBlockTooltip,
  }),
}));

describe('GenerateTopologyButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAgentBuilder = { openChat: mockOpenChat };
    mockBlocksActivity = false;
    mockActivityBlockTooltip = undefined;
  });

  it('hides when agent builder is unavailable', () => {
    mockAgentBuilder = undefined;
    const { container } = render(<GenerateTopologyButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens a new chat using existing knowledge indicators as the source', () => {
    render(<GenerateTopologyButton />);
    fireEvent.click(screen.getByTestId('significantEventsGenerateTopologyButton'));

    expect(mockOpenChat).toHaveBeenCalledWith({
      newConversation: true,
      initialMessage: GENERATE_TOPOLOGY_INITIAL_MESSAGE,
      autoSendInitialMessage: true,
    });
    expect(GENERATE_TOPOLOGY_INITIAL_MESSAGE).toMatch(/existing knowledge indicators/i);
    expect(GENERATE_TOPOLOGY_INITIAL_MESSAGE).toMatch(/Do not run feature identification/i);
  });

  it('disables while new activity is blocked', () => {
    mockBlocksActivity = true;
    mockActivityBlockTooltip = 'Paused';
    render(<GenerateTopologyButton />);
    expect(screen.getByTestId('significantEventsGenerateTopologyButton')).toBeDisabled();
  });
});
