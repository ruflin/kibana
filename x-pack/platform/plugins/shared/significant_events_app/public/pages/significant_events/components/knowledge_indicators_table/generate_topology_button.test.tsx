/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { GenerateTopologyButton } from './generate_topology_button';

const mockOnGenerate = jest.fn();
let mockBlocksActivity = false;
let mockActivityBlockTooltip: string | undefined;

jest.mock('../../../../hooks/use_significant_events_maintenance', () => ({
  useBlocksNewActivity: () => ({
    blocksActivity: mockBlocksActivity,
    activityBlockTooltip: mockActivityBlockTooltip,
  }),
}));

describe('GenerateTopologyButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBlocksActivity = false;
    mockActivityBlockTooltip = undefined;
  });

  it('regenerates topology for the current stream filter without opening chat', () => {
    render(
      <GenerateTopologyButton
        selectedStreamNames={['logs.claims', 'logs.payments']}
        onGenerate={mockOnGenerate}
      />
    );
    fireEvent.click(screen.getByTestId('significantEventsGenerateTopologyButton'));

    expect(mockOnGenerate).toHaveBeenCalledTimes(1);
    expect(mockOnGenerate).toHaveBeenCalledWith(['logs.claims', 'logs.payments']);
  });

  it('regenerates across the existing knowledge-indicator set when no streams are selected', () => {
    render(<GenerateTopologyButton onGenerate={mockOnGenerate} />);
    fireEvent.click(screen.getByTestId('significantEventsGenerateTopologyButton'));

    expect(mockOnGenerate).toHaveBeenCalledWith([]);
  });

  it('is available even when Agent Builder is not present', () => {
    render(<GenerateTopologyButton onGenerate={mockOnGenerate} />);
    expect(screen.getByTestId('significantEventsGenerateTopologyButton')).toBeEnabled();
  });

  it('disables while new activity is blocked', () => {
    mockBlocksActivity = true;
    mockActivityBlockTooltip = 'Paused';
    render(<GenerateTopologyButton onGenerate={mockOnGenerate} />);
    expect(screen.getByTestId('significantEventsGenerateTopologyButton')).toBeDisabled();
  });

  it('shows a loading state while regeneration is in progress', () => {
    render(<GenerateTopologyButton isLoading onGenerate={mockOnGenerate} />);
    expect(screen.getByTestId('significantEventsGenerateTopologyButton')).toBeDisabled();
  });
});
