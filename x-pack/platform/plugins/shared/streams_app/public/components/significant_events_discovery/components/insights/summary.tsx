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
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { TaskStatus } from '@kbn/streams-schema';
import React, { useEffect, useRef, useState } from 'react';
import useAsyncFn from 'react-use/lib/useAsyncFn';
import type { Discovery, Insight, Recommendation } from '@kbn/streams-schema';
import { useAIFeatures } from '../../../../hooks/use_ai_features';
import { useInsightsDiscoveryApi } from '../../../../hooks/use_insights_discovery_api';
import { useKibana } from '../../../../hooks/use_kibana';
import { useTaskPolling } from '../../../../hooks/use_task_polling';
import { getFormattedError } from '../../../../util/errors';
import { ConnectorListButton } from '../../../connector_list_button/connector_list_button';
import { FeedbackButtons } from './feedback_buttons';
import { DiscoveryCard } from './discovery_card';
import { InsightCard } from './insight_card';
import { RecommendationCard } from './recommendation_card';

interface PipelineResult {
  discoveries: Discovery[];
  insights: Insight[];
  recommendations: Recommendation[];
}

export function Summary({ count }: { count: number }) {
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
          defaultMessage: 'Error generating analysis',
        }),
      });
      return;
    }

    if (task?.status === TaskStatus.Completed) {
      const discoveryCount = task.discoveries?.length ?? 0;
      const insightCount = task.insights?.length ?? 0;
      const recommendationCount = task.recommendations?.length ?? 0;

      if (
        previousStatus === TaskStatus.InProgress &&
        discoveryCount === 0 &&
        insightCount === 0
      ) {
        notifications.toasts.addInfo({
          title: i18n.translate('xpack.streams.insights.noResultsTitle', {
            defaultMessage: 'No discoveries found',
          }),
          text: i18n.translate('xpack.streams.insights.noResultsDescription', {
            defaultMessage:
              'The AI could not extract any discoveries from the current significant events. Try again later when more events are available.',
          }),
        });
      }
      setPipelineResult({
        discoveries: task.discoveries ?? [],
        insights: task.insights ?? [],
        recommendations: task.recommendations ?? [],
      });
    }
  }, [task, notifications.toasts]);

  const { cancelTask, isCancellingTask } = useTaskPolling({
    task,
    onPoll: getInsightsDiscoveryTaskStatus,
    onRefresh: getTaskStatus,
    onCancel: cancelInsightsDiscoveryTask,
  });

  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);

  const onGenerateClick = async () => {
    await scheduleTask();
  };

  const onRegenerateClick = async () => {
    await acknowledgeInsightsDiscoveryTask();
    await scheduleTask();
    setPipelineResult(null);
  };

  const isGenerateButtonPending =
    task?.status === TaskStatus.InProgress || isCancellingTask || isSchedulingTask;

  const hasResults =
    pipelineResult &&
    (pipelineResult.discoveries.length > 0 ||
      pipelineResult.insights.length > 0 ||
      pipelineResult.recommendations.length > 0);

  if (hasResults) {
    return (
      <EuiFlexGroup direction="column">
        <EuiFlexItem>
          <EuiPanel hasBorder paddingSize="none">
            <EuiPanel color="subdued" hasShadow={false}>
              <EuiFlexGroup justifyContent="flexEnd">
                <EuiFlexItem grow={false}>
                  <FeedbackButtons />
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiButton
                    fill={true}
                    iconType="refresh"
                    onClick={onRegenerateClick}
                    disabled={isSchedulingTask}
                    isLoading={isSchedulingTask}
                    data-test-subj="significant_events_regenerate_insights_button"
                  >
                    {i18n.translate('xpack.streams.insights.regenerateButtonLabel', {
                      defaultMessage: 'Re-generate analysis',
                    })}
                  </EuiButton>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiPanel>
            <EuiPanel hasShadow={false}>
              {pipelineResult.discoveries.length > 0 && (
                <>
                  <EuiTitle size="s">
                    <h2>
                      {i18n.translate('xpack.streams.insights.discoveriesSectionTitle', {
                        defaultMessage: 'Discoveries ({count})',
                        values: { count: pipelineResult.discoveries.length },
                      })}
                    </h2>
                  </EuiTitle>
                  <EuiSpacer size="s" />
                  <EuiText size="xs" color="subdued">
                    {i18n.translate('xpack.streams.insights.discoveriesSectionDescription', {
                      defaultMessage: 'Factual observations extracted from significant events.',
                    })}
                  </EuiText>
                  <EuiSpacer size="m" />
                  <EuiFlexGroup direction="column" gutterSize="m">
                    {pipelineResult.discoveries.map((discovery, idx) => (
                      <EuiFlexItem key={idx}>
                        <DiscoveryCard discovery={discovery} index={idx} />
                      </EuiFlexItem>
                    ))}
                  </EuiFlexGroup>
                  <EuiSpacer size="l" />
                </>
              )}

              {pipelineResult.insights.length > 0 && (
                <>
                  <EuiTitle size="s">
                    <h2>
                      {i18n.translate('xpack.streams.insights.insightsSectionTitle', {
                        defaultMessage: 'Insights ({count})',
                        values: { count: pipelineResult.insights.length },
                      })}
                    </h2>
                  </EuiTitle>
                  <EuiSpacer size="s" />
                  <EuiText size="xs" color="subdued">
                    {i18n.translate('xpack.streams.insights.insightsSectionDescription', {
                      defaultMessage:
                        'Analytical conclusions drawn from the discoveries, including correlations and root causes.',
                    })}
                  </EuiText>
                  <EuiSpacer size="m" />
                  <EuiFlexGroup direction="column" gutterSize="m">
                    {pipelineResult.insights.map((insight, idx) => (
                      <EuiFlexItem key={idx}>
                        <InsightCard insight={insight} index={idx} />
                      </EuiFlexItem>
                    ))}
                  </EuiFlexGroup>
                  <EuiSpacer size="l" />
                </>
              )}

              {pipelineResult.recommendations.length > 0 && (
                <>
                  <EuiTitle size="s">
                    <h2>
                      {i18n.translate('xpack.streams.insights.recommendationsSectionTitle', {
                        defaultMessage: 'Recommendations ({count})',
                        values: { count: pipelineResult.recommendations.length },
                      })}
                    </h2>
                  </EuiTitle>
                  <EuiSpacer size="s" />
                  <EuiText size="xs" color="subdued">
                    {i18n.translate('xpack.streams.insights.recommendationsSectionDescription', {
                      defaultMessage:
                        'Actionable steps to investigate, mitigate, or resolve the identified issues.',
                    })}
                  </EuiText>
                  <EuiSpacer size="m" />
                  <EuiFlexGroup direction="column" gutterSize="m">
                    {pipelineResult.recommendations.map((recommendation, idx) => (
                      <EuiFlexItem key={idx}>
                        <RecommendationCard recommendation={recommendation} index={idx} />
                      </EuiFlexItem>
                    ))}
                  </EuiFlexGroup>
                </>
              )}
            </EuiPanel>
          </EuiPanel>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

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
              <EuiIcon type="createAdvancedJob" size="xxl" aria-hidden={true} />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiTitle size="s">
                <h2>
                  {i18n.translate(
                    'xpack.streams.sigEventsDiscovery.insightsTab.significantEventsFoundTitle',
                    {
                      defaultMessage:
                        '{count} significant {count, plural, one {event} other {events}} detected',
                      values: {
                        count,
                      },
                    }
                  )}
                </h2>
              </EuiTitle>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiText size="s" textAlign="center" css={{ maxWidth: 400 }}>
                {i18n.translate(
                  'xpack.streams.sigEventsDiscovery.insightsTab.significantEventsFoundDescription',
                  {
                    defaultMessage:
                      'Start analyzing your significant events to extract discoveries, generate insights, and get actionable recommendations with the power of AI and Elastic Observability.',
                  }
                )}
              </EuiText>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiFlexGroup>
                <ConnectorListButton
                  buttonProps={{
                    fill: true,
                    size: 'm',
                    iconType: 'sparkles',
                    children:
                      task?.status === TaskStatus.InProgress
                        ? i18n.translate('xpack.streams.insights.generatingButtonLabel', {
                            defaultMessage: 'Analyzing events',
                          })
                        : i18n.translate('xpack.streams.insights.generateButtonLabel', {
                            defaultMessage: 'Analyze events',
                          }),
                    onClick: onGenerateClick,
                    isDisabled: isGenerateButtonPending,
                    isLoading: isGenerateButtonPending,
                    'data-test-subj': 'significant_events_generate_insights_button',
                  }}
                />

                {(task?.status === TaskStatus.InProgress || isCancellingTask) && (
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
                )}
              </EuiFlexGroup>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiPanel>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}
