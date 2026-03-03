/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTable,
  EuiButton,
  EuiCodeBlock,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiIcon,
  EuiLoadingElastic,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  type EuiBasicTableColumn,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { Suggestion } from '@kbn/streams-schema';
import { useKibana } from '../../../../hooks/use_kibana';
import { useStreamsAppFetch } from '../../../../hooks/use_streams_app_fetch';

const typeLabels: Record<string, string> = {
  alert: 'Alert',
  dashboard: 'Dashboard',
  slo: 'SLO',
  viz: 'Visualization',
};

const typeIcons: Record<string, string> = {
  alert: 'bell',
  dashboard: 'dashboardApp',
  slo: 'visGauge',
  viz: 'visArea',
};

const statusColors: Record<string, 'default' | 'success' | 'danger'> = {
  pending: 'default',
  accepted: 'success',
  dismissed: 'danger',
};

const priorityColors: Record<string, 'danger' | 'warning' | 'primary' | 'hollow'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'primary',
  low: 'hollow',
};

export function SuggestionsTab() {
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();

  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null);

  const suggestionsFetch = useStreamsAppFetch(
    async ({ signal }) =>
      streamsRepositoryClient.fetch('GET /internal/streams/_suggestions', {
        params: { query: {} },
        signal,
      }),
    [streamsRepositoryClient]
  );

  const handleStatusUpdate = useCallback(
    async (uuid: string, status: 'accepted' | 'dismissed') => {
      await streamsRepositoryClient.fetch('POST /internal/streams/_suggestions/{uuid}/_status', {
        params: {
          path: { uuid },
          body: { status },
        },
      });
      suggestionsFetch.refresh();
      setSelectedSuggestion(null);
    },
    [streamsRepositoryClient, suggestionsFetch]
  );

  const columns: Array<EuiBasicTableColumn<Suggestion>> = useMemo(
    () => [
      {
        field: 'type',
        name: i18n.translate('xpack.streams.suggestions.typeColumn', { defaultMessage: 'Type' }),
        width: '100px',
        render: (type: string) => (
          <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiIcon type={typeIcons[type] ?? 'document'} />
            </EuiFlexItem>
            <EuiFlexItem>{typeLabels[type] ?? type}</EuiFlexItem>
          </EuiFlexGroup>
        ),
      },
      {
        field: 'title',
        name: i18n.translate('xpack.streams.suggestions.titleColumn', { defaultMessage: 'Title' }),
      },
      {
        field: 'priority',
        name: i18n.translate('xpack.streams.suggestions.priorityColumn', {
          defaultMessage: 'Priority',
        }),
        width: '100px',
        render: (priority: string) => (
          <EuiBadge color={priorityColors[priority] ?? 'hollow'}>{priority}</EuiBadge>
        ),
      },
      {
        field: 'status',
        name: i18n.translate('xpack.streams.suggestions.statusColumn', {
          defaultMessage: 'Status',
        }),
        width: '100px',
        render: (status: string) => (
          <EuiBadge color={statusColors[status] ?? 'default'}>{status}</EuiBadge>
        ),
      },
      {
        field: 'stream_refs',
        name: i18n.translate('xpack.streams.suggestions.streamsColumn', {
          defaultMessage: 'Streams',
        }),
        render: (refs: string[]) => refs?.join(', ') ?? '',
      },
    ],
    []
  );

  if (suggestionsFetch.loading) {
    return <EuiLoadingElastic />;
  }

  const suggestions = (suggestionsFetch.value ?? []) as Suggestion[];

  if (suggestions.length === 0) {
    return (
      <EuiFlexGroup direction="column" alignItems="center" justifyContent="center">
        <EuiFlexItem grow={false}>
          <EuiPanel color="subdued">
            <EuiFlexGroup
              direction="column"
              alignItems="center"
              justifyContent="center"
              style={{ minHeight: '30vh', minWidth: '40vh' }}
            >
              <EuiFlexItem grow={false}>
                <EuiIcon type="editorCodeBlock" size="xxl" aria-hidden />
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiTitle size="s">
                  <h2>
                    {i18n.translate('xpack.streams.suggestions.noSuggestionsTitle', {
                      defaultMessage: 'No suggestions yet',
                    })}
                  </h2>
                </EuiTitle>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiText size="s" textAlign="center" css={{ maxWidth: 400 }}>
                  {i18n.translate('xpack.streams.suggestions.noSuggestionsDescription', {
                    defaultMessage:
                      'Run the discovery pipeline to generate ES|QL query suggestions from your discoveries.',
                  })}
                </EuiText>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiPanel>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

  return (
    <>
      <EuiBasicTable
        items={suggestions}
        columns={columns}
        rowProps={(item) => ({
          onClick: () => setSelectedSuggestion(item),
          style: { cursor: 'pointer' },
        })}
      />

      {selectedSuggestion && (
        <EuiFlyout onClose={() => setSelectedSuggestion(null)} size="m">
          <EuiFlyoutHeader hasBorder>
            <EuiFlexGroup alignItems="center" gutterSize="m">
              <EuiFlexItem grow={false}>
                <EuiIcon type={typeIcons[selectedSuggestion.type] ?? 'document'} size="l" />
              </EuiFlexItem>
              <EuiFlexItem>
                <EuiTitle size="m">
                  <h2>{selectedSuggestion.title}</h2>
                </EuiTitle>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiFlyoutHeader>
          <EuiFlyoutBody>
            <EuiFlexGroup gutterSize="s">
              <EuiFlexItem grow={false}>
                <EuiBadge color={priorityColors[selectedSuggestion.priority] ?? 'hollow'}>
                  {selectedSuggestion.priority}
                </EuiBadge>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiBadge>{typeLabels[selectedSuggestion.type] ?? selectedSuggestion.type}</EuiBadge>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiBadge color={statusColors[selectedSuggestion.status] ?? 'default'}>
                  {selectedSuggestion.status}
                </EuiBadge>
              </EuiFlexItem>
            </EuiFlexGroup>

            <EuiSpacer size="m" />

            <EuiText size="s">
              <p>{selectedSuggestion.description}</p>
            </EuiText>

            <EuiSpacer size="m" />

            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.suggestions.esqlQuery', {
                  defaultMessage: 'ES|QL Query',
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiCodeBlock language="esql" isCopyable paddingSize="m">
              {selectedSuggestion.esql_query}
            </EuiCodeBlock>

            <EuiSpacer size="m" />

            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.suggestions.reason', {
                  defaultMessage: 'Reason',
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiText size="s">
              <p>{selectedSuggestion.reason}</p>
            </EuiText>

            {selectedSuggestion.status === 'pending' && (
              <>
                <EuiSpacer size="l" />
                <EuiFlexGroup gutterSize="s">
                  <EuiFlexItem grow={false}>
                    <EuiButton
                      fill
                      color="success"
                      onClick={() => handleStatusUpdate(selectedSuggestion.uuid, 'accepted')}
                    >
                      {i18n.translate('xpack.streams.suggestions.accept', {
                        defaultMessage: 'Accept',
                      })}
                    </EuiButton>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiButton
                      color="danger"
                      onClick={() => handleStatusUpdate(selectedSuggestion.uuid, 'dismissed')}
                    >
                      {i18n.translate('xpack.streams.suggestions.dismiss', {
                        defaultMessage: 'Dismiss',
                      })}
                    </EuiButton>
                  </EuiFlexItem>
                </EuiFlexGroup>
              </>
            )}
          </EuiFlyoutBody>
        </EuiFlyout>
      )}
    </>
  );
}
