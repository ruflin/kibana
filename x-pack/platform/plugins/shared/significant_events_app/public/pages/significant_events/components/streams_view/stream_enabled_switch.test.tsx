/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { StreamEnabledSwitch } from './stream_enabled_switch';
import { getEnableStreamToggleAriaLabel } from './translations';

describe('StreamEnabledSwitch', () => {
  it('renders an accessible switch and reports the next enabled state', () => {
    const onEnabledChange = jest.fn();
    render(
      <StreamEnabledSwitch
        streamName="logs.app"
        checked={false}
        disabled={false}
        onEnabledChange={onEnabledChange}
      />
    );

    const toggle = screen.getByTestId('significantEventsStreamEnabledSwitch-logs.app');
    expect(toggle).toHaveAccessibleName(getEnableStreamToggleAriaLabel('logs.app'));

    fireEvent.click(toggle);
    expect(onEnabledChange).toHaveBeenCalledWith('logs.app', true);
  });

  it('does not call onEnabledChange when disabled', () => {
    const onEnabledChange = jest.fn();
    render(
      <StreamEnabledSwitch
        streamName="logs.app"
        checked={false}
        disabled
        disabledTooltip="Paused"
        onEnabledChange={onEnabledChange}
      />
    );

    fireEvent.click(screen.getByTestId('significantEventsStreamEnabledSwitch-logs.app'));
    expect(onEnabledChange).not.toHaveBeenCalled();
  });
});
