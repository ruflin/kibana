/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { useBlocksNewActivity } from '../../../hooks/use_significant_events_maintenance';
import { useSignificantEventsPageContext } from '../context/significant_events_page_context';
import { ManagementSubTabs, type ManagementSubTabItem } from './management_sub_tabs';
import { FindSignificantEventsButton } from './streams_view/find_significant_events_button';

/** Significant Events subtabs with Find Significant Events on the right. */
export function SignificantEventsSubTabsChrome({ items }: { items: ManagementSubTabItem[] }) {
  const { isRunning, isCanceling, handleRun, handleCancel } = useSignificantEventsPageContext();
  const { blocksActivity, activityBlockTooltip } = useBlocksNewActivity();

  return (
    <ManagementSubTabs
      items={items}
      data-test-subj="significantEventsSubTabs"
      extra={
        <FindSignificantEventsButton
          onRun={handleRun}
          onCancel={handleCancel}
          isRunning={isRunning}
          isCanceling={isCanceling}
          isDisabled={isRunning || blocksActivity}
          disabledTooltip={activityBlockTooltip}
        />
      }
    />
  );
}
