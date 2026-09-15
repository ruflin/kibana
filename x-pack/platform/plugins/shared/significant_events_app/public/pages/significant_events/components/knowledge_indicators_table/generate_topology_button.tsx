/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiButton, EuiToolTip } from '@elastic/eui';
import React, { useCallback } from 'react';
import { useKibana } from '../../../../hooks/use_kibana';
import { useBlocksNewActivity } from '../../../../hooks/use_significant_events_maintenance';
import { GENERATE_TOPOLOGY_BUTTON_LABEL, GENERATE_TOPOLOGY_INITIAL_MESSAGE } from './translations';

export function GenerateTopologyButton() {
  const {
    dependencies: {
      start: { agentBuilder },
    },
  } = useKibana();
  const { blocksActivity, activityBlockTooltip } = useBlocksNewActivity();

  const handleGenerateTopology = useCallback(() => {
    agentBuilder?.openChat({
      newConversation: true,
      initialMessage: GENERATE_TOPOLOGY_INITIAL_MESSAGE,
      autoSendInitialMessage: true,
    });
  }, [agentBuilder]);

  if (!agentBuilder) {
    return null;
  }

  const button = (
    <EuiButton
      iconType="sparkles"
      onClick={handleGenerateTopology}
      isDisabled={blocksActivity}
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
