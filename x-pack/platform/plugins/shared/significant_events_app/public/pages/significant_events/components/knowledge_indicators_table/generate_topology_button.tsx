/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiButton, EuiToolTip } from '@elastic/eui';
import React, { useCallback } from 'react';
import { useBlocksNewActivity } from '../../../../hooks/use_significant_events_maintenance';
import { GENERATE_TOPOLOGY_BUTTON_LABEL } from './translations';

export function GenerateTopologyButton({
  selectedStreamNames = [],
  isLoading = false,
  onGenerate,
}: {
  selectedStreamNames?: string[];
  isLoading?: boolean;
  onGenerate: (streamNames: string[]) => void;
}) {
  const { blocksActivity, activityBlockTooltip } = useBlocksNewActivity();

  const handleGenerateTopology = useCallback(() => {
    onGenerate(selectedStreamNames);
  }, [onGenerate, selectedStreamNames]);

  const button = (
    <EuiButton
      iconType="sparkles"
      onClick={handleGenerateTopology}
      isDisabled={blocksActivity || isLoading}
      isLoading={isLoading}
      data-test-subj="significantEventsGenerateTopologyButton"
    >
      {GENERATE_TOPOLOGY_BUTTON_LABEL}
    </EuiButton>
  );

  if (blocksActivity && activityBlockTooltip) {
    return <EuiToolTip content={activityBlockTooltip}>{button}</EuiToolTip>;
  }

  return button;
}
