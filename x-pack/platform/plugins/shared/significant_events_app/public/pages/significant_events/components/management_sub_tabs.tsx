/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiFlexGroup, EuiFlexItem, EuiSpacer, EuiTabs, EuiTab } from '@elastic/eui';
import React from 'react';
import type { ReactNode } from 'react';

export interface ManagementSubTabItem {
  id: string;
  label: string;
  href: string;
  isSelected: boolean;
}

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
    <>
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
    </>
  );
}
