/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { SignificantEventsSubTabsChrome } from './significant_events_sub_tabs_chrome';

jest.mock('../../context/significant_events_page_context', () => ({
  useSignificantEventsPageContext: jest.fn(() => ({
    isRunning: false,
    isCanceling: false,
    handleRun: jest.fn(),
    handleCancel: jest.fn(),
  })),
}));

jest.mock('../../../hooks/use_significant_events_maintenance', () => ({
  useBlocksNewActivity: jest.fn(() => ({
    blocksActivity: false,
    activityBlockTooltip: undefined,
  })),
}));

jest.mock('./streams_view/find_significant_events_button', () => ({
  FindSignificantEventsButton: () => (
    <button type="button" data-test-subj="significant_events_discovery_button">
      Find Significant Events
    </button>
  ),
}));

const items = [
  { id: 'events', label: 'Events', href: '/events', isSelected: true },
  { id: 'rules', label: 'Rules', href: '/rules', isSelected: false },
  { id: 'detections', label: 'Detections', href: '/detections', isSelected: false },
];

describe('SignificantEventsSubTabsChrome', () => {
  it('renders Find Significant Events on the Significant Events subtab row', () => {
    render(<SignificantEventsSubTabsChrome items={items} />);

    const tabs = screen.getByTestId('significantEventsSubTabs');
    const button = screen.getByTestId('significant_events_discovery_button');

    expect(screen.getByRole('tab', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rules' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Detections' })).toBeInTheDocument();
    expect(button).toBeInTheDocument();
    expect(tabs).not.toContainElement(button);
  });
});
