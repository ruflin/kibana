/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiSpacer, EuiTabs, EuiTab } from '@elastic/eui';
import React from 'react';

export interface ManagementSubTabItem {
  id: string;
  label: string;
  href: string;
  isSelected: boolean;
}

export function ManagementSubTabs({
  items,
  'data-test-subj': dataTestSubj,
}: {
  items: ManagementSubTabItem[];
  'data-test-subj'?: string;
}) {
  return (
    <>
      <EuiTabs data-test-subj={dataTestSubj}>
        {items.map((item) => (
          <EuiTab key={item.id} href={item.href} isSelected={item.isSelected}>
            {item.label}
          </EuiTab>
        ))}
      </EuiTabs>
      <EuiSpacer />
    </>
  );
}
