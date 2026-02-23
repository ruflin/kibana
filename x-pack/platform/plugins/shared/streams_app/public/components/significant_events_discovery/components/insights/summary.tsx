/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  EuiButton,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiPanel,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { TaskStatus } from '@kbn/streams-schema';
import React, { useCallback, useEffect, useRef } from 'react';
import useAsyncFn from 'react-use/lib/useAsyncFn';
import type { Insight, PersistedInsight } from '@kbn/streams-schema';
import { useAIFeatures } from '../../../../hooks/use_ai_features';
import { useInsightsDiscoveryApi } from '../../../../hooks/use_insights_discovery_api';
import { useKibana } from '../../../../hooks/use_kibana';
import { useTaskPolling } from '../../../../hooks/use_task_polling';
import { getFormattedError } from '../../../../util/errors';
import { ConnectorListButton } from '../../../connector_list_button/connector_list_button';
import { FeedbackButtons } from './feedback_buttons';
import { InsightCard } from './insight_card';

interface SummaryProps {
  persistedInsights: PersistedInsight[];
  onInsightsChanged: () => void;
}

export function Summary({ persistedInsights, onInsightsChanged }: SummaryProps) {
  const aiFeatures = useAIFeatures();
  const {
    core: { notifications },
  } = useKibana();

  const {
    scheduleInsightsDiscoveryTask,
    getInsightsDiscoveryTaskStatus,
    acknowledgeInsightsDiscoveryTask,
    cancelInsightsDiscoveryTask,
  } = useInsightsDiscoveryApi(aiFeatures?.genAiConnectors.selectedConnector);

  const [{ value: task }, getTaskStatus] = useAsyncFn(getInsightsDiscoveryTaskStatus);
  const [{ loading: isSchedulingTask }, scheduleTask] = useAsyncFn(async () => {
    await scheduleInsightsDiscoveryTask();
    await getTaskStatus();
  }, [scheduleInsightsDiscoveryTask, getTaskStatus]);

  useEffect(() => {
    getTaskStatus();
  }, [getTaskStatus]);

  const previousTaskStatusRef = useRef<TaskStatus | undefined>(undefined);

  useEffect(() => {
    const previousStatus = previousTaskStatusRef.current;
    previousTaskStatusRef.current = task?.status;

    if (task?.status === TaskStatus.Failed) {
      notifications.toasts.addError(getFormattedError(new Error(task.error)), {
        title: i18n.translate('xpack.streams.insights.errorTitle', {
          defaultMessage: 'Error generating insights',
        }),
      });
      return;
    }

    if (task?.status === TaskStatus.Completed && previousStatus === TaskStatus.InProgress) {
      if (task.insights.length === 0) {
        notifications.toasts.addInfo({
          title: i18n.translate('xpack.streams.insights.noInsightsTitle', {
            defaultMessage: 'No insights found',
          }),
          text: i18n.translate('xpack.streams.insights.noInsightsDescription', {
            defaultMessage:
              'The AI could not generate any insights from the current significant events. Try again later when more events are available.',
          }),
        });
      }
      onInsightsChanged();
    }
  }, [task, notifications.toasts, onInsightsChanged]);

  const { cancelTask, isCancellingTask } = useTaskPolling({
    task,
    onPoll: getInsightsDiscoveryTaskStatus,
    onRefresh: getTaskStatus,
    onCancel: cancelInsightsDiscoveryTask,
  });

  const onGenerateInsightsClick = useCallback(async () => {
    await scheduleTask();
  }, [scheduleTask]);

  const onRegenerateInsightsClick = useCallback(async () => {
    await acknowledgeInsightsDiscoveryTask();
    await scheduleTask();
  }, [acknowledgeInsightsDiscoveryTask, scheduleTask]);

  const isGenerateButtonPending =
    task?.status === TaskStatus.InProgress || isCancellingTask || isSchedulingTask;

  const displayInsights: Insight[] = persistedInsights;

  return (
    <EuiFlexGroup direction="column">
      <EuiFlexItem>
        <EuiPanel hasBorder paddingSize="none">
          <EuiPanel color="subdued" hasShadow={false}>
            <EuiFlexGroup justifyContent="spaceBetween" alignItems="center">
              <EuiFlexItem grow={false}>
                <EuiTitle size="xs">
                  <h3>
                    {i18n.translate('xpack.streams.insights.insightsTitle', {
                      defaultMessage:
                        '{count} {count, plural, one {insight} other {insights}}',
                      values: { count: displayInsights.length },
                    })}
                  </h3>
                </EuiTitle>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiFlexGroup gutterSize="s" alignItems="center">
                  <EuiFlexItem grow={false}>
                    <FeedbackButtons />
                  </EuiFlexItem>
                  {displayInsights.length > 0 ? (
                    <EuiFlexItem grow={false}>
                      <ConnectorListButton
                        buttonProps={{
                          iconType: 'refresh',
                          fill: true,
                          children: isGenerateButtonPending
                            ? i18n.translate('xpack.streams.insights.regeneratingButtonLabel', {
                                defaultMessage: 'Generating...',
                              })
                            : i18n.translate('xpack.streams.insights.regenerateButtonLabel', {
                                defaultMessage: 'Re-generate insights',
                              }),
                          onClick: onRegenerateInsightsClick,
                          isDisabled: isGenerateButtonPending,
                          isLoading: isGenerateButtonPending,
                          'data-test-subj': 'significant_events_regenerate_insights_button',
                        }}
                      />
                    </EuiFlexItem>
                  ) : (
                    <>
                      <EuiFlexItem grow={false}>
                        <ConnectorListButton
                          buttonProps={{
                            fill: true,
                            size: 'm',
                            iconType: 'sparkles',
                            children: isGenerateButtonPending
                              ? i18n.translate('xpack.streams.insights.generatingButtonLabel', {
                                  defaultMessage: 'Generating insights',
                                })
                              : i18n.translate('xpack.streams.insights.generateButtonLabel', {
                                  defaultMessage: 'Generate insights',
                                }),
                            onClick: onGenerateInsightsClick,
                            isDisabled: isGenerateButtonPending,
                            isLoading: isGenerateButtonPending,
                            'data-test-subj': 'significant_events_generate_insights_button',
                          }}
                        />
                      </EuiFlexItem>
                    </>
                  )}
                  {(task?.status === TaskStatus.InProgress || isCancellingTask) && (
                    <EuiFlexItem grow={false}>
                      <EuiButton
                        onClick={cancelTask}
                        isDisabled={isCancellingTask}
                        data-test-subj="significant_events_cancel_insights_generation_button"
                      >
                        {isCancellingTask
                          ? i18n.translate('xpack.streams.insights.cancellingTaskButtonLabel', {
                              defaultMessage: 'Cancelling',
                            })
                          : i18n.translate('xpack.streams.insights.cancelTaskButtonLabel', {
                              defaultMessage: 'Cancel',
                            })}
                      </EuiButton>
                    </EuiFlexItem>
                  )}
                </EuiFlexGroup>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiPanel>
          {displayInsights.length > 0 ? (
            <EuiPanel hasShadow={false}>
              <EuiFlexGroup direction="column" gutterSize="m">
                {displayInsights.map((insight, idx) => (
                  <EuiFlexItem key={idx}>
                    <InsightCard insight={insight} index={idx} />
                  </EuiFlexItem>
                ))}
              </EuiFlexGroup>
            </EuiPanel>
          ) : (
            <EuiPanel hasShadow={false}>
              <EuiFlexGroup
                direction="column"
                alignItems="center"
                justifyContent="center"
                gutterSize="m"
                style={{ minHeight: '20vh' }}
              >
                <EuiFlexItem grow={false}>
                  <EuiIcon type="createAdvancedJob" size="xxl" aria-hidden={true} />
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiText size="s" textAlign="center" css={{ maxWidth: 400 }}>
                    {i18n.translate(
                      'xpack.streams.sigEventsDiscovery.insightsTab.noInsightsYetDescription',
                      {
                        defaultMessage:
                          'No insights yet. Generate insights from your significant events using AI, or insights will appear here as they are created by agents and tasks.',
                      }
                    )}
                  </EuiText>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiPanel>
          )}
        </EuiPanel>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}
