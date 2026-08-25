/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  EuiButton,
  EuiButtonEmpty,
  EuiComboBox,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiFlyoutHeader,
  EuiFormRow,
  EuiTextArea,
  EuiTitle,
  useGeneratedHtmlId,
} from '@elastic/eui';
import React, { useMemo, useState } from 'react';
import { useFetchDataViewsCatalog } from '../../hooks/use_data_views';
import {
  ADD_EXISTING_FLYOUT_TITLE,
  ADD_VIEW_CONFIRM,
  CANCEL_LABEL,
  CREATE_FLYOUT_TITLE,
  CREATE_VIEW_CONFIRM,
  VIEW_NAME_LABEL,
  VIEW_QUERY_LABEL,
} from './translations';

interface AddExistingViewFlyoutProps {
  configuredNames: Set<string>;
  isLoading: boolean;
  onClose: () => void;
  onAdd: (name: string) => Promise<unknown>;
}

export function AddExistingViewFlyout({
  configuredNames,
  isLoading,
  onClose,
  onAdd,
}: AddExistingViewFlyoutProps) {
  const catalog = useFetchDataViewsCatalog(true);
  const [selected, setSelected] = useState<string | undefined>();
  const titleId = useGeneratedHtmlId({ prefix: 'addExistingViewFlyoutTitle' });

  const options = useMemo(
    () =>
      (catalog.data?.views ?? [])
        .filter((view) => !configuredNames.has(view.name))
        .map((view) => ({ label: view.name })),
    [catalog.data?.views, configuredNames]
  );

  return (
    <EuiFlyout
      onClose={onClose}
      size="s"
      ownFocus
      aria-labelledby={titleId}
      data-test-subj="significantEventsAddExistingViewFlyout"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s">
          <h2 id={titleId}>{ADD_EXISTING_FLYOUT_TITLE}</h2>
        </EuiTitle>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiFormRow label={VIEW_NAME_LABEL} fullWidth>
          <EuiComboBox
            data-test-subj="significantEventsAddExistingViewCombo"
            aria-label={VIEW_NAME_LABEL}
            singleSelection={{ asPlainText: true }}
            options={options}
            selectedOptions={selected ? [{ label: selected }] : []}
            onChange={(next) => setSelected(next[0]?.label)}
            isLoading={catalog.isLoading}
            fullWidth
          />
        </EuiFormRow>
      </EuiFlyoutBody>
      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="flexEnd">
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty onClick={onClose}>{CANCEL_LABEL}</EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton
              fill
              isDisabled={!selected}
              isLoading={isLoading}
              onClick={async () => {
                if (!selected) return;
                await onAdd(selected);
                onClose();
              }}
              data-test-subj="significantEventsAddExistingViewConfirm"
            >
              {ADD_VIEW_CONFIRM}
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
}

interface CreateViewFlyoutProps {
  isLoading: boolean;
  onClose: () => void;
  onCreate: (params: { name: string; query: string }) => Promise<unknown>;
}

export function CreateViewFlyout({ isLoading, onClose, onCreate }: CreateViewFlyoutProps) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('FROM logs-*');
  const titleId = useGeneratedHtmlId({ prefix: 'createViewFlyoutTitle' });

  const canSubmit = name.trim().length > 0 && query.trim().length > 0;

  return (
    <EuiFlyout
      onClose={onClose}
      size="m"
      ownFocus
      aria-labelledby={titleId}
      data-test-subj="significantEventsCreateViewFlyout"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s">
          <h2 id={titleId}>{CREATE_FLYOUT_TITLE}</h2>
        </EuiTitle>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiFormRow label={VIEW_NAME_LABEL} fullWidth>
          <EuiFieldText
            data-test-subj="significantEventsCreateViewName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="prod-logs"
            fullWidth
          />
        </EuiFormRow>
        <EuiFormRow label={VIEW_QUERY_LABEL} fullWidth>
          <EuiTextArea
            data-test-subj="significantEventsCreateViewQuery"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            rows={8}
            fullWidth
            style={{ fontFamily: 'monospace' }}
          />
        </EuiFormRow>
      </EuiFlyoutBody>
      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="flexEnd">
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty onClick={onClose}>{CANCEL_LABEL}</EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton
              fill
              isDisabled={!canSubmit}
              isLoading={isLoading}
              onClick={async () => {
                await onCreate({ name: name.trim(), query: query.trim() });
                onClose();
              }}
              data-test-subj="significantEventsCreateViewConfirm"
            >
              {CREATE_VIEW_CONFIRM}
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
}
