/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiSwitch, EuiToolTip } from '@elastic/eui';
import React from 'react';
import { getEnableStreamToggleAriaLabel } from './translations';

export function StreamEnabledSwitch({
  streamName,
  checked,
  disabled,
  disabledTooltip,
  onEnabledChange,
}: {
  streamName: string;
  checked: boolean;
  disabled: boolean;
  disabledTooltip?: string;
  onEnabledChange: (streamName: string, enabled: boolean) => void;
}) {
  const label = getEnableStreamToggleAriaLabel(streamName);
  const switchControl = (
    <EuiSwitch
      compressed
      showLabel={false}
      label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onEnabledChange(streamName, event.target.checked)}
      data-test-subj={`significantEventsStreamEnabledSwitch-${streamName}`}
    />
  );

  if (!disabled || !disabledTooltip) {
    return switchControl;
  }

  return (
    <EuiToolTip content={disabledTooltip} disableScreenReaderOutput>
      {switchControl}
    </EuiToolTip>
  );
}
