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
import { SelectDataStreamsFlyout } from './select_data_streams_flyout';
import {
  ADD_DATA_SOURCE_BUTTON_LABEL,
  ADD_DATA_SOURCE_POPOVER_ARIA_LABEL,
  ADD_QUERY_STREAM_MENU_ITEM_LABEL,
  ADD_SELECT_DATA_STREAMS_MENU_ITEM_LABEL,
} from './translations';

type OpenFlyout = 'queryStream' | 'selectDataStreams' | null;

export function AddDataSourceButton() {
  const [isPopoverOpen, { off: closePopover, toggle: togglePopover }] = useBoolean(false);
  const [openFlyout, setOpenFlyout] = useState<OpenFlyout>(null);

  const openQueryStreamFlyout = useCallback(() => {
    closePopover();
    setOpenFlyout('queryStream');
  }, [closePopover]);

  const openSelectDataStreamsFlyout = useCallback(() => {
    closePopover();
    setOpenFlyout('selectDataStreams');
  }, [closePopover]);

  const closeFlyout = useCallback(() => {
    setOpenFlyout(null);
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
          {
            name: ADD_SELECT_DATA_STREAMS_MENU_ITEM_LABEL,
            icon: 'indexOpen',
            onClick: openSelectDataStreamsFlyout,
            'data-test-subj': 'significantEventsSelectDataStreamsMenuItem',
          },
        ],
      },
    ],
    [openQueryStreamFlyout, openSelectDataStreamsFlyout]
  );

  return (
    <>
      <EuiPopover
        button={
          <EuiButton
            size="s"
            iconType="plusCircle"
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
      {openFlyout === 'queryStream' && <CreateQueryStreamFlyout onClose={closeFlyout} />}
      {openFlyout === 'selectDataStreams' && <SelectDataStreamsFlyout onClose={closeFlyout} />}
    </>
  );
}
