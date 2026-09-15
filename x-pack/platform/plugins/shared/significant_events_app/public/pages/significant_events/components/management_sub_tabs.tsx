/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiFlexGroup, EuiFlexItem, EuiSpacer, EuiTabs, EuiTab } from '@elastic/eui';
import { css } from '@emotion/react';
import React from 'react';
import type { ReactNode } from 'react';

export interface ManagementSubTabItem {
  id: string;
  label: string;
  href: string;
  isSelected: boolean;
}

// The page body is a full-height column flex; EuiFlexGroup always grows, so wrap
// the tab row or it expands and vertically centers above the table.
const chromeCss = css`
  flex-grow: 0;
  flex-shrink: 0;
`;

export function ManagementSubTabs({
  items,
  extra,
  'data-test-subj': dataTestSubj,
}: {
  items: ManagementSubTabItem[];
  extra?: ReactNode;
  'data-test-subj'?: string;
}) {
  return (
    <div css={chromeCss} data-test-subj="managementSubTabsChrome">
      <EuiFlexGroup
        alignItems="center"
        justifyContent="spaceBetween"
        gutterSize="s"
        responsive={false}
      >
        <EuiFlexItem grow>
          <EuiTabs data-test-subj={dataTestSubj}>
            {items.map((item) => (
              <EuiTab key={item.id} href={item.href} isSelected={item.isSelected}>
                {item.label}
              </EuiTab>
            ))}
          </EuiTabs>
        </EuiFlexItem>
        {extra ? <EuiFlexItem grow={false}>{extra}</EuiFlexItem> : null}
      </EuiFlexGroup>
      <EuiSpacer />
    </div>
  );
}
