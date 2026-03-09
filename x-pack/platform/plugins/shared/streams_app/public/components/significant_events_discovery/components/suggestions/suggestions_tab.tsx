/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTable,
  EuiButton,
  EuiCodeBlock,
  EuiEmptyPrompt,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiIcon,
  EuiSpacer,
  EuiText,
  EuiTitle,
  type EuiBasicTableColumn,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { Suggestion } from '@kbn/streams-schema';
import { TaskStatus } from '@kbn/streams-schema';
import useAsyncFn from 'react-use/lib/useAsyncFn';
import { useAIFeatures } from '../../../../hooks/use_ai_features';
import { useKibana } from '../../../../hooks/use_kibana';
import { useStreamsAppFetch } from '../../../../hooks/use_streams_app_fetch';
import { useSuggestionPipelineApi } from '../../../../hooks/use_suggestion_pipeline_api';
import { useTaskPolling } from '../../../../hooks/use_task_polling';
import { getFormattedError } from '../../../../util/errors';

const typeLabels: Record<string, string> = {
  alert: 'Alert',
  dashboard: 'Dashboard',
  slo: 'SLO',
  viz: 'Visualization',
  investigation: 'Investigation',
};

const typeIcons: Record<string, string> = {
  alert: 'bell',
  dashboard: 'dashboardApp',
  slo: 'visGauge',
  viz: 'visArea',
  investigation: 'folderCheck',
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
  const aiFeatures = useAIFeatures();
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
    core: { notifications },
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

  const {
    scheduleSuggestionTask,
    getSuggestionTaskStatus,
    acknowledgeSuggestionTask,
    cancelSuggestionTask,
  } = useSuggestionPipelineApi(aiFeatures?.genAiConnectors.selectedConnector);

  const [{ value: task }, getTaskStatus] = useAsyncFn(getSuggestionTaskStatus);
  const [{ loading: isSchedulingTask }, scheduleTask] = useAsyncFn(async () => {
    await scheduleSuggestionTask();
    await getTaskStatus();
  }, [scheduleSuggestionTask, getTaskStatus]);

  useEffect(() => {
    getTaskStatus().then((taskResult) => {
      if (taskResult?.status === TaskStatus.Failed || taskResult?.status === TaskStatus.Completed) {
        acknowledgeSuggestionTask().catch(() => {});
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previousTaskStatusRef = useRef<TaskStatus | undefined>(undefined);

  useEffect(() => {
    try {
      const previousStatus = previousTaskStatusRef.current;
      previousTaskStatusRef.current = task?.status;

      if (task?.status === TaskStatus.Failed && previousStatus === TaskStatus.InProgress) {
        notifications.toasts.addError(
          getFormattedError(new Error(task.error ?? 'Unknown error')),
          {
            title: i18n.translate('xpack.streams.suggestions.errorTitle', {
              defaultMessage: 'Error generating suggestions',
            }),
          }
        );
      }

      if (task?.status === TaskStatus.Completed && previousStatus === TaskStatus.InProgress) {
        const count = task.suggestions?.length ?? 0;
        if (count > 0) {
          notifications.toasts.addSuccess({
            title: i18n.translate('xpack.streams.suggestions.generatedTitle', {
              defaultMessage:
                '{count} {count, plural, one {suggestion} other {suggestions}} generated',
              values: { count },
            }),
          });
        } else {
          notifications.toasts.addInfo({
            title: i18n.translate('xpack.streams.suggestions.noSuggestionsGeneratedTitle', {
              defaultMessage: 'No suggestions generated',
            }),
            text: i18n.translate('xpack.streams.suggestions.noSuggestionsGeneratedDescription', {
              defaultMessage:
                'The AI could not generate suggestions from the current discoveries. Make sure discoveries exist first.',
            }),
          });
        }
        suggestionsFetch.refresh();
      }
    } catch {
      // Guard against stale task data or unexpected shapes
    }
  }, [task, notifications.toasts, suggestionsFetch]);

  const { cancelTask, isCancellingTask } = useTaskPolling({
    task,
    onPoll: getSuggestionTaskStatus,
    onRefresh: getTaskStatus,
    onCancel: cancelSuggestionTask,
  });

  const isGenerating =
    task?.status === TaskStatus.InProgress || isCancellingTask || isSchedulingTask;

  const handleGenerate = useCallback(async () => {
    try {
      await acknowledgeSuggestionTask();
    } catch {
      // Ignore 409 conflicts — task may already be acknowledged or not exist
    }
    await scheduleTask();
  }, [acknowledgeSuggestionTask, scheduleTask]);

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

  const suggestions = (suggestionsFetch.value ?? []) as Suggestion[];

  return (
    <>
      <EuiFlexGroup direction="column" gutterSize="l">
        <EuiFlexItem grow={false}>
          <EuiFlexGroup alignItems="center" gutterSize="m">
            <EuiFlexItem grow={false}>
              <EuiButton
                fill
                iconType="sparkles"
                onClick={handleGenerate}
                isDisabled={isGenerating}
                isLoading={isGenerating}
                data-test-subj="significant_events_generate_suggestions_button"
              >
                {isGenerating
                  ? i18n.translate('xpack.streams.suggestions.generatingButtonLabel', {
                      defaultMessage: 'Generating suggestions...',
                    })
                  : i18n.translate('xpack.streams.suggestions.generateButtonLabel', {
                      defaultMessage: 'Generate suggestions',
                    })}
              </EuiButton>
            </EuiFlexItem>
            {(task?.status === TaskStatus.InProgress || isCancellingTask) && (
              <EuiFlexItem grow={false}>
                <EuiButton
                  color="text"
                  onClick={cancelTask}
                  isDisabled={isCancellingTask}
                  data-test-subj="significant_events_cancel_suggestions_generation_button"
                >
                  {isCancellingTask
                    ? i18n.translate('xpack.streams.suggestions.cancellingTaskButtonLabel', {
                        defaultMessage: 'Cancelling...',
                      })
                    : i18n.translate('xpack.streams.suggestions.cancelTaskButtonLabel', {
                        defaultMessage: 'Cancel',
                      })}
                </EuiButton>
              </EuiFlexItem>
            )}
          </EuiFlexGroup>
        </EuiFlexItem>

        <EuiFlexItem>
          {suggestionsFetch.loading ? (
            <EuiEmptyPrompt
              icon={<EuiIcon type="clock" size="xl" />}
              title={
                <h3>
                  {i18n.translate('xpack.streams.suggestions.loadingTitle', {
                    defaultMessage: 'Loading suggestions...',
                  })}
                </h3>
              }
            />
          ) : suggestions.length === 0 ? (
            <EuiEmptyPrompt
              icon={<EuiIcon type="editorCodeBlock" size="xl" />}
              title={
                <h3>
                  {i18n.translate('xpack.streams.suggestions.noSuggestionsTitle', {
                    defaultMessage: 'No suggestions yet',
                  })}
                </h3>
              }
              body={
                <p>
                  {i18n.translate('xpack.streams.suggestions.noSuggestionsDescription', {
                    defaultMessage:
                      'Click "Generate suggestions" to create ES|QL query suggestions from your discoveries and recommendations.',
                  })}
                </p>
              }
            />
          ) : (
            <EuiBasicTable
              items={suggestions}
              columns={columns}
              rowProps={(item) => ({
                onClick: () => setSelectedSuggestion(item),
                style: { cursor: 'pointer' },
              })}
            />
          )}
        </EuiFlexItem>
      </EuiFlexGroup>

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
