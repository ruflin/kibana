/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ManagementSubTabs } from './management_sub_tabs';

const items = [
  { id: 'events', label: 'Events', href: '/events', isSelected: true },
  { id: 'rules', label: 'Rules', href: '/rules', isSelected: false },
];

describe('ManagementSubTabs', () => {
  it('renders subtabs without an extra action', () => {
    render(<ManagementSubTabs items={items} data-test-subj="managementSubTabs" />);

    expect(screen.getByTestId('managementSubTabs')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rules' })).toBeInTheDocument();
  });

  it('renders extra content outside the tab list and aligned on the row', () => {
    render(
      <ManagementSubTabs
        items={items}
        data-test-subj="managementSubTabs"
        extra={<button data-test-subj="managementSubTabsExtra">Find Significant Events</button>}
      />
    );

    const extra = screen.getByTestId('managementSubTabsExtra');
    expect(extra).toBeInTheDocument();
    expect(screen.getByTestId('managementSubTabs')).not.toContainElement(extra);
  });

  it('does not grow to fill a column flex parent', () => {
    render(<ManagementSubTabs items={items} data-test-subj="managementSubTabs" />);

    const chrome = screen.getByTestId('managementSubTabsChrome');
    expect(chrome).toContainElement(screen.getByTestId('managementSubTabs'));
    expect(chrome).toHaveStyle({ flexGrow: '0', flexShrink: '0' });
  });
});
