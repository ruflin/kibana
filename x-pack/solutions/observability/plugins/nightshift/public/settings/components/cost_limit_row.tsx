/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { EuiFieldNumber, EuiFormRow, EuiSpacer, EuiSwitch } from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import {
  MAX_COST_LIMIT_USD,
  MIN_ENABLED_COST_LIMIT_USD,
  NO_COST_LIMIT,
  isValidEnabledCostLimitDraft,
  parseCostLimitDraft,
  type CostLimitDraft,
} from './cost_limit_draft';

interface CostLimitRowProps {
  costLimit: CostLimitDraft;
  tokenTrackingEnabled: boolean;
  disabled: boolean;
  onChange: (costLimit: CostLimitDraft) => void;
  onEnabledChange: (enabled: boolean) => void;
}

export const CostLimitRow = ({
  costLimit,
  tokenTrackingEnabled,
  disabled,
  onChange,
  onEnabledChange,
}: CostLimitRowProps) => {
  const limitEnabled = costLimit !== NO_COST_LIMIT;
  const invalid = limitEnabled && !isValidEnabledCostLimitDraft(costLimit);
  const label = i18n.translate('xpack.nightshift.settings.costLimit.inputLabel', {
    defaultMessage: 'Daily cost limit (USD)',
  });
  const trackingOffText = i18n.translate(
    'xpack.nightshift.settings.costLimit.trackingOffHelpText',
    {
      defaultMessage:
        'Token usage tracking is turned off, so the cost limit is not enforced. Turn on token usage tracking to enforce it.',
    }
  );

  return (
    <div data-test-subj="nightshiftCostLimitRow">
      <EuiFormRow
        helpText={
          tokenTrackingEnabled
            ? i18n.translate('xpack.nightshift.settings.costLimit.helpText', {
                defaultMessage:
                  'Applies to all scheduled Nightshift activity combined, using estimated model costs. New scheduled runs are blocked once the estimated spend for the day reaches the limit. Runs already in progress are not stopped.',
              })
            : trackingOffText
        }
      >
        <EuiSwitch
          label={i18n.translate('xpack.nightshift.settings.costLimit.enabledSwitchLabel', {
            defaultMessage: 'Enforce daily cost limit',
          })}
          checked={limitEnabled}
          disabled={disabled || (!tokenTrackingEnabled && !limitEnabled)}
          onChange={(event) => onEnabledChange(event.target.checked)}
          data-test-subj="nightshiftCostLimitEnabledSwitch"
        />
      </EuiFormRow>

      {limitEnabled && (
        <>
          <EuiSpacer size="m" />
          <EuiFormRow
            label={label}
            isInvalid={invalid}
            error={
              invalid
                ? i18n.translate('xpack.nightshift.settings.costLimit.invalidLimitErrorMessage', {
                    defaultMessage: 'Enter an amount from {minimum} to {maximum}.',
                    values: { minimum: MIN_ENABLED_COST_LIMIT_USD, maximum: MAX_COST_LIMIT_USD },
                  })
                : undefined
            }
          >
            <EuiFieldNumber
              compressed
              prepend="$"
              aria-label={label}
              data-test-subj="nightshiftCostLimitInput"
              value={costLimit}
              min={MIN_ENABLED_COST_LIMIT_USD}
              max={MAX_COST_LIMIT_USD}
              step={0.01}
              isInvalid={invalid}
              disabled={disabled || !tokenTrackingEnabled}
              onChange={(event) => {
                const nextLimit = parseCostLimitDraft(event.target.value);
                if (nextLimit !== NO_COST_LIMIT) {
                  onChange(nextLimit);
                }
              }}
            />
          </EuiFormRow>
        </>
      )}
    </div>
  );
};
