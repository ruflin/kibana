/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiButton, EuiContextMenu, EuiPopover } from '@elastic/eui';
import { useBoolean } from '@kbn/react-hooks';
import React, { useCallback, useMemo, useState } from 'react';
import { CreateQueryStreamFlyout } from './create_query_stream_flyout';
import {
  ADD_DATA_SOURCE_BUTTON_LABEL,
  ADD_DATA_SOURCE_POPOVER_ARIA_LABEL,
  ADD_QUERY_STREAM_MENU_ITEM_LABEL,
} from './translations';

export function AddDataSourceButton() {
  const [isPopoverOpen, { off: closePopover, toggle: togglePopover }] = useBoolean(false);
  const [isQueryStreamFlyoutOpen, setIsQueryStreamFlyoutOpen] = useState(false);

  const openQueryStreamFlyout = useCallback(() => {
    closePopover();
    setIsQueryStreamFlyoutOpen(true);
  }, [closePopover]);

  const closeQueryStreamFlyout = useCallback(() => {
    setIsQueryStreamFlyoutOpen(false);
  }, []);

  const panels = useMemo(
    () => [
      {
        id: 0,
        items: [
          {
            name: ADD_QUERY_STREAM_MENU_ITEM_LABEL,
            icon: 'plus',
            onClick: openQueryStreamFlyout,
            'data-test-subj': 'significantEventsAddQueryStreamMenuItem',
          },
        ],
      },
    ],
    [openQueryStreamFlyout]
  );

  return (
    <>
      <EuiPopover
        button={
          <EuiButton
            size="s"
            iconType="plusInCircle"
            onClick={togglePopover}
            data-test-subj="significantEventsAddDataSourceButton"
          >
            {ADD_DATA_SOURCE_BUTTON_LABEL}
          </EuiButton>
        }
        isOpen={isPopoverOpen}
        closePopover={closePopover}
        panelPaddingSize="none"
        anchorPosition="downLeft"
        aria-label={ADD_DATA_SOURCE_POPOVER_ARIA_LABEL}
      >
        <EuiContextMenu initialPanelId={0} panels={panels} />
      </EuiPopover>
      {isQueryStreamFlyoutOpen && <CreateQueryStreamFlyout onClose={closeQueryStreamFlyout} />}
    </>
  );
}
