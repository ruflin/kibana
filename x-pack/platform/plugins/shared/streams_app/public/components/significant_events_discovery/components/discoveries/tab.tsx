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
  EuiDescriptionList,
  EuiEmptyPrompt,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiIcon,
  EuiListGroup,
  EuiListGroupItem,
  EuiMarkdownFormat,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  type EuiBasicTableColumn,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { Discovery, DiscoveryEvidence, Recommendation } from '@kbn/streams-schema';
import { TaskStatus } from '@kbn/streams-schema';
import useAsyncFn from 'react-use/lib/useAsyncFn';
import { useAIFeatures } from '../../../../hooks/use_ai_features';
import { useDiscoveryPipelineApi } from '../../../../hooks/use_discovery_pipeline_api';
import { useKibana } from '../../../../hooks/use_kibana';
import { useStreamsAppFetch } from '../../../../hooks/use_streams_app_fetch';
import { useTaskPolling } from '../../../../hooks/use_task_polling';
import { getFormattedError } from '../../../../util/errors';

const severityColors: Record<string, 'danger' | 'warning' | 'primary' | 'hollow'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'primary',
  low: 'hollow',
};

const formatDate = (date: string): string => {
  try {
    return new Date(date).toLocaleString();
  } catch {
    return date;
  }
};

function DiscoveryDetailFlyout({
  discovery,
  onClose,
}: {
  discovery: Discovery;
  onClose: () => void;
}) {
  return (
    <EuiFlyout onClose={onClose} size="m">
      <EuiFlyoutHeader hasBorder>
        <EuiFlexGroup alignItems="center" gutterSize="m">
          <EuiFlexItem grow={false}>
            <EuiBadge color={severityColors[discovery.severity] ?? 'hollow'}>
              {discovery.severity}
            </EuiBadge>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiTitle size="m">
              <h2>{discovery.title}</h2>
            </EuiTitle>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiDescriptionList
          type="column"
          compressed
          listItems={[
            {
              title: i18n.translate('xpack.streams.discoveryDetail.relevance', {
                defaultMessage: 'Relevance',
              }),
              description: `${discovery.relevance_score}/100`,
            },
            {
              title: i18n.translate('xpack.streams.discoveryDetail.level', {
                defaultMessage: 'Level',
              }),
              description: String(discovery.level),
            },
            {
              title: i18n.translate('xpack.streams.discoveryDetail.created', {
                defaultMessage: 'Created',
              }),
              description: formatDate(discovery.created_at),
            },
            {
              title: i18n.translate('xpack.streams.discoveryDetail.updated', {
                defaultMessage: 'Updated',
              }),
              description: formatDate(discovery.updated_at),
            },
          ]}
        />

        <EuiSpacer size="l" />

        <EuiTitle size="xs">
          <h3>
            {i18n.translate('xpack.streams.discoveryDetail.description', {
              defaultMessage: 'Description',
            })}
          </h3>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiMarkdownFormat textSize="s">{discovery.description}</EuiMarkdownFormat>

        {discovery.stream_refs.length > 0 && (
          <>
            <EuiSpacer size="l" />
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.discoveryDetail.streams', {
                  defaultMessage: 'Streams',
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiFlexGroup gutterSize="xs" wrap>
              {discovery.stream_refs.map((ref) => (
                <EuiFlexItem grow={false} key={ref}>
                  <EuiBadge>{ref}</EuiBadge>
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
          </>
        )}

        {discovery.tags && discovery.tags.length > 0 && (
          <>
            <EuiSpacer size="l" />
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.discoveryDetail.tags', {
                  defaultMessage: 'Tags',
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiFlexGroup gutterSize="xs" wrap>
              {discovery.tags.map((tag) => (
                <EuiFlexItem grow={false} key={tag}>
                  <EuiBadge color="hollow">{tag}</EuiBadge>
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
          </>
        )}

        {discovery.evidence.length > 0 && (
          <>
            <EuiSpacer size="l" />
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.discoveryDetail.evidence', {
                  defaultMessage: 'Evidence ({count})',
                  values: { count: discovery.evidence.length },
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            {discovery.evidence.map((ev: DiscoveryEvidence, idx: number) => (
              <EuiPanel key={idx} paddingSize="s" hasBorder css={{ marginBottom: 4 }}>
                <EuiText size="xs">
                  <strong>{ev.query_title}</strong>
                  {' — '}
                  {ev.stream_name}
                  {' · '}
                  {ev.event_count} events
                  {ev.change_point_type && (
                    <>
                      {' · '}
                      {ev.change_point_type}
                      {ev.change_point_p_value != null && ` (p=${ev.change_point_p_value})`}
                    </>
                  )}
                  {ev.feature_name && (
                    <>
                      {' · '}
                      {ev.feature_name}
                    </>
                  )}
                </EuiText>
              </EuiPanel>
            ))}
          </>
        )}

        {discovery.recommendations && discovery.recommendations.length > 0 && (
          <>
            <EuiSpacer size="l" />
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.discoveryDetail.recommendations', {
                  defaultMessage: 'Recommendations ({count})',
                  values: { count: discovery.recommendations.length },
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            {discovery.recommendations.map((rec: Recommendation, idx: number) => {
              const hasUniqueDescription =
                rec.description && rec.description !== rec.title;
              const hasUniqueSteps =
                rec.steps.length > 0 &&
                !(rec.steps.length === 1 && rec.steps[0] === rec.title);

              return (
                <EuiPanel key={idx} paddingSize="s" hasBorder css={{ marginBottom: 8 }}>
                  <EuiFlexGroup alignItems="center" gutterSize="s">
                    <EuiFlexItem grow={false}>
                      <EuiBadge color={severityColors[rec.priority] ?? 'hollow'}>
                        {rec.priority}
                      </EuiBadge>
                    </EuiFlexItem>
                    <EuiFlexItem>
                      <EuiText size="s">{rec.title}</EuiText>
                    </EuiFlexItem>
                  </EuiFlexGroup>
                  {hasUniqueDescription && (
                    <>
                      <EuiSpacer size="xs" />
                      <EuiMarkdownFormat textSize="xs">
                        {rec.description}
                      </EuiMarkdownFormat>
                    </>
                  )}
                  {hasUniqueSteps && (
                    <>
                      <EuiSpacer size="xs" />
                      <EuiListGroup flush maxWidth={false}>
                        {rec.steps.map((step, stepIdx) => (
                          <EuiListGroupItem
                            key={stepIdx}
                            label={`${stepIdx + 1}. ${step}`}
                            size="xs"
                          />
                        ))}
                      </EuiListGroup>
                    </>
                  )}
                </EuiPanel>
              );
            })}
          </>
        )}

        {(discovery.query_refs?.length ||
          discovery.feature_refs?.length ||
          discovery.discovery_refs?.length) && (
          <>
            <EuiSpacer size="l" />
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.discoveryDetail.references', {
                  defaultMessage: 'References',
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            {discovery.query_refs && discovery.query_refs.length > 0 && (
              <>
                <EuiText size="xs">
                  <strong>
                    {i18n.translate('xpack.streams.discoveryDetail.queryRefs', {
                      defaultMessage: 'Queries',
                    })}
                  </strong>
                </EuiText>
                <EuiListGroup flush maxWidth={false} gutterSize="none">
                  {discovery.query_refs.map((ref) => (
                    <EuiListGroupItem key={ref} label={ref} size="xs" />
                  ))}
                </EuiListGroup>
              </>
            )}
            {discovery.feature_refs && discovery.feature_refs.length > 0 && (
              <>
                <EuiSpacer size="s" />
                <EuiText size="xs">
                  <strong>
                    {i18n.translate('xpack.streams.discoveryDetail.featureRefs', {
                      defaultMessage: 'Features',
                    })}
                  </strong>
                </EuiText>
                <EuiListGroup flush maxWidth={false} gutterSize="none">
                  {discovery.feature_refs.map((ref) => (
                    <EuiListGroupItem key={ref} label={ref} size="xs" />
                  ))}
                </EuiListGroup>
              </>
            )}
            {discovery.discovery_refs && discovery.discovery_refs.length > 0 && (
              <>
                <EuiSpacer size="s" />
                <EuiText size="xs">
                  <strong>
                    {i18n.translate('xpack.streams.discoveryDetail.discoveryRefs', {
                      defaultMessage: 'Related discoveries',
                    })}
                  </strong>
                </EuiText>
                <EuiListGroup flush maxWidth={false} gutterSize="none">
                  {discovery.discovery_refs.map((ref) => (
                    <EuiListGroupItem key={ref} label={ref} size="xs" />
                  ))}
                </EuiListGroup>
              </>
            )}
          </>
        )}

        {discovery.feedback && (
          <>
            <EuiSpacer size="l" />
            <EuiDescriptionList
              type="column"
              compressed
              listItems={[
                {
                  title: i18n.translate('xpack.streams.discoveryDetail.feedback', {
                    defaultMessage: 'Feedback',
                  }),
                  description: (
                    <EuiBadge color={discovery.feedback === 'useful' ? 'success' : 'danger'}>
                      {discovery.feedback}
                    </EuiBadge>
                  ),
                },
              ]}
            />
          </>
        )}
      </EuiFlyoutBody>
    </EuiFlyout>
  );
}

export function DiscoveriesTab() {
  const aiFeatures = useAIFeatures();
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
    core: { notifications },
  } = useKibana();

  const [selectedDiscovery, setSelectedDiscovery] = useState<Discovery | null>(null);

  const discoveriesFetch = useStreamsAppFetch(
    async ({ signal }) =>
      streamsRepositoryClient.fetch('GET /internal/streams/_discoveries', {
        params: { query: {} },
        signal,
      }),
    [streamsRepositoryClient]
  );

  const {
    scheduleDiscoveryPipelineTask,
    getDiscoveryPipelineTaskStatus,
    acknowledgeDiscoveryPipelineTask,
    cancelDiscoveryPipelineTask,
  } = useDiscoveryPipelineApi(aiFeatures?.genAiConnectors.selectedConnector);

  const [{ value: task }, getTaskStatus] = useAsyncFn(getDiscoveryPipelineTaskStatus);
  const [{ loading: isSchedulingTask }, scheduleTask] = useAsyncFn(async () => {
    await scheduleDiscoveryPipelineTask();
    await getTaskStatus();
  }, [scheduleDiscoveryPipelineTask, getTaskStatus]);

  useEffect(() => {
    getTaskStatus();
  }, [getTaskStatus]);

  const previousTaskStatusRef = useRef<TaskStatus | undefined>(undefined);

  useEffect(() => {
    const previousStatus = previousTaskStatusRef.current;
    previousTaskStatusRef.current = task?.status;

    if (task?.status === TaskStatus.Failed) {
      notifications.toasts.addError(getFormattedError(new Error(task.error)), {
        title: i18n.translate('xpack.streams.discoveries.errorTitle', {
          defaultMessage: 'Error generating discoveries',
        }),
      });
    }

    if (task?.status === TaskStatus.Completed && previousStatus === TaskStatus.InProgress) {
      const count = task.discoveries?.length ?? 0;
      if (count > 0) {
        notifications.toasts.addSuccess({
          title: i18n.translate('xpack.streams.discoveries.generatedTitle', {
            defaultMessage: '{count} {count, plural, one {discovery} other {discoveries}} generated',
            values: { count },
          }),
        });
      } else {
        notifications.toasts.addInfo({
          title: i18n.translate('xpack.streams.discoveries.noDiscoveriesTitle', {
            defaultMessage: 'No discoveries found',
          }),
          text: i18n.translate('xpack.streams.discoveries.noDiscoveriesDescription', {
            defaultMessage:
              'The AI could not generate any discoveries from the current significant events. Try again later when more events are available.',
          }),
        });
      }
      discoveriesFetch.refresh();
    }
  }, [task, notifications.toasts, discoveriesFetch]);

  const { cancelTask, isCancellingTask } = useTaskPolling({
    task,
    onPoll: getDiscoveryPipelineTaskStatus,
    onRefresh: getTaskStatus,
    onCancel: cancelDiscoveryPipelineTask,
  });

  const isGenerating =
    task?.status === TaskStatus.InProgress || isCancellingTask || isSchedulingTask;

  const handleGenerate = useCallback(async () => {
    if (task?.status === TaskStatus.Completed || task?.status === TaskStatus.Failed) {
      await acknowledgeDiscoveryPipelineTask();
    }
    await scheduleTask();
  }, [task, acknowledgeDiscoveryPipelineTask, scheduleTask]);

  const discoveries = (discoveriesFetch.value ?? []) as Discovery[];

  const columns: Array<EuiBasicTableColumn<Discovery>> = useMemo(
    () => [
      {
        field: 'severity',
        name: i18n.translate('xpack.streams.discoveries.severityColumn', {
          defaultMessage: 'Severity',
        }),
        width: '100px',
        render: (severity: string) => (
          <EuiBadge color={severityColors[severity] ?? 'hollow'}>{severity}</EuiBadge>
        ),
      },
      {
        field: 'title',
        name: i18n.translate('xpack.streams.discoveries.titleColumn', {
          defaultMessage: 'Title',
        }),
      },
      {
        field: 'relevance_score',
        name: i18n.translate('xpack.streams.discoveries.relevanceColumn', {
          defaultMessage: 'Relevance',
        }),
        width: '100px',
        render: (score: number) => `${score}/100`,
      },
      {
        field: 'stream_refs',
        name: i18n.translate('xpack.streams.discoveries.streamsColumn', {
          defaultMessage: 'Streams',
        }),
        render: (refs: string[]) => refs?.join(', ') ?? '',
      },
      {
        field: 'created_at',
        name: i18n.translate('xpack.streams.discoveries.createdColumn', {
          defaultMessage: 'Created',
        }),
        width: '180px',
        render: (date: string) => formatDate(date),
      },
    ],
    []
  );

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
                data-test-subj="significant_events_generate_discoveries_button"
              >
                {isGenerating
                  ? i18n.translate('xpack.streams.discoveries.generatingButtonLabel', {
                      defaultMessage: 'Generating discoveries...',
                    })
                  : i18n.translate('xpack.streams.discoveries.generateButtonLabel', {
                      defaultMessage: 'Generate discoveries',
                    })}
              </EuiButton>
            </EuiFlexItem>
            {(task?.status === TaskStatus.InProgress || isCancellingTask) && (
              <EuiFlexItem grow={false}>
                <EuiButton
                  color="text"
                  onClick={cancelTask}
                  isDisabled={isCancellingTask}
                  data-test-subj="significant_events_cancel_discoveries_generation_button"
                >
                  {isCancellingTask
                    ? i18n.translate('xpack.streams.discoveries.cancellingTaskButtonLabel', {
                        defaultMessage: 'Cancelling...',
                      })
                    : i18n.translate('xpack.streams.discoveries.cancelTaskButtonLabel', {
                        defaultMessage: 'Cancel',
                      })}
                </EuiButton>
              </EuiFlexItem>
            )}
          </EuiFlexGroup>
        </EuiFlexItem>

        <EuiFlexItem>
          {discoveriesFetch.loading ? (
            <EuiEmptyPrompt
              icon={<EuiIcon type="clock" size="xl" />}
              title={
                <h3>
                  {i18n.translate('xpack.streams.discoveries.loadingTitle', {
                    defaultMessage: 'Loading discoveries...',
                  })}
                </h3>
              }
            />
          ) : discoveries.length === 0 ? (
            <EuiEmptyPrompt
              icon={<EuiIcon type="createAdvancedJob" size="xl" />}
              title={
                <h3>
                  {i18n.translate('xpack.streams.discoveries.emptyTitle', {
                    defaultMessage: 'No discoveries yet',
                  })}
                </h3>
              }
              body={
                <p>
                  {i18n.translate('xpack.streams.discoveries.emptyDescription', {
                    defaultMessage:
                      'Click "Generate discoveries" to analyze significant events and extract insights using AI.',
                  })}
                </p>
              }
            />
          ) : (
            <EuiBasicTable
              items={discoveries}
              columns={columns}
              rowProps={(item) => ({
                onClick: () => setSelectedDiscovery(item),
                style: { cursor: 'pointer' },
              })}
            />
          )}
        </EuiFlexItem>
      </EuiFlexGroup>

      {selectedDiscovery && (
        <DiscoveryDetailFlyout
          discovery={selectedDiscovery}
          onClose={() => setSelectedDiscovery(null)}
        />
      )}
    </>
  );
}
