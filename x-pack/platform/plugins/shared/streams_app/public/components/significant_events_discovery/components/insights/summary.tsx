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
import React, { useEffect, useRef, useState } from 'react';
import useAsyncFn from 'react-use/lib/useAsyncFn';
import type { Discovery, Insight } from '@kbn/streams-schema';
import { useAIFeatures } from '../../../../hooks/use_ai_features';
import { useDiscoveryPipelineApi } from '../../../../hooks/use_insights_discovery_api';
import { useKibana } from '../../../../hooks/use_kibana';
import { useTaskPolling } from '../../../../hooks/use_task_polling';
import { getFormattedError } from '../../../../util/errors';
import { ConnectorListButton } from '../../../connector_list_button/connector_list_button';
import { FeedbackButtons } from './feedback_buttons';
import { DiscoveryCard } from './insight_card';

function mapDiscoveryToInsight(d: Discovery): Insight {
  return {
    title: d.title,
    description: d.description,
    impact: d.severity,
    evidence: d.evidence.map((e) => ({
      streamName: e.stream_name,
      queryTitle: e.query_title,
      featureName: e.feature_name,
      eventCount: e.event_count,
    })),
    recommendations: (d.recommendations ?? []).flatMap((r) => [r.title, ...r.steps]),
  };
}

export function Summary({ count }: { count: number }) {
  const aiFeatures = useAIFeatures();
  const {
    core: { notifications },
  } = useKibana();

  const {
    scheduleDiscoveryPipelineTask,
    getDiscoveryPipelineTaskStatus,
    acknowledgeDiscoveryPipelineTask,
    cancelDiscoveryPipelineTask,
  } = useDiscoveryPipelineApi(aiFeatures?.genAiConnectors.selectedConnector);

  const [{ value: task }, getTaskStatus] = useAsyncFn(getDiscoveryPipelineTaskStatus);
  const [{ loading: isSchedulingTask }, scheduleTask] = useAsyncFn(async () => {
    /**
     * Combining scheduling and immediate status update to prevent
     * React updating the UI in between states causing flickering
     */
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
      return;
    }

    if (task?.status === TaskStatus.Completed) {
      const discoveries = task.discoveries ?? [];
      if (previousStatus === TaskStatus.InProgress && discoveries.length === 0) {
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
      setDiscoveries(discoveries.map(mapDiscoveryToInsight));
    }
  }, [task, notifications.toasts]);

  const { cancelTask, isCancellingTask } = useTaskPolling({
    task,
    onPoll: getDiscoveryPipelineTaskStatus,
    onRefresh: getTaskStatus,
    onCancel: cancelDiscoveryPipelineTask,
  });

  const [discoveries, setDiscoveries] = useState<Insight[] | null>(null);

  const onGenerateDiscoveriesClick = async () => {
    await scheduleTask();
  };

  const onRegenerateDiscoveriesClick = async () => {
    await acknowledgeDiscoveryPipelineTask();
    await scheduleTask();

    setDiscoveries(null);
  };

  const isGenerateButtonPending =
    task?.status === TaskStatus.InProgress || isCancellingTask || isSchedulingTask;

  if (discoveries && discoveries.length > 0) {
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
                    onClick={onRegenerateDiscoveriesClick}
                    disabled={isSchedulingTask}
                    isLoading={isSchedulingTask}
                    data-test-subj="significant_events_regenerate_discoveries_button"
                  >
                    {i18n.translate('xpack.streams.discoveries.regenerateButtonLabel', {
                      defaultMessage: 'Re-generate discoveries',
                    })}
                  </EuiButton>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiPanel>
            <EuiPanel hasShadow={false}>
              <EuiFlexGroup direction="column" gutterSize="m">
                {discoveries.map((insight, idx) => (
                  <EuiFlexItem key={idx}>
                    <DiscoveryCard insight={insight} index={idx} />
                  </EuiFlexItem>
                ))}
              </EuiFlexGroup>
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
                    'xpack.streams.sigEventsDiscovery.discoveriesTab.significantEventsFoundTitle',
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
                  'xpack.streams.sigEventsDiscovery.discoveriesTab.significantEventsFoundDescription',
                  {
                    defaultMessage:
                      'Start extracting discoveries from your logs, and understand what they mean with the power of AI and Elastic Observability.',
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
                        ? i18n.translate('xpack.streams.discoveries.generatingButtonLabel', {
                            defaultMessage: 'Generating discoveries',
                          })
                        : i18n.translate('xpack.streams.discoveries.generateButtonLabel', {
                            defaultMessage: 'Generate discoveries',
                          }),
                    onClick: onGenerateDiscoveriesClick,
                    isDisabled: isGenerateButtonPending,
                    isLoading: isGenerateButtonPending,
                    'data-test-subj': 'significant_events_generate_discoveries_button',
                  }}
                />

                {(task?.status === TaskStatus.InProgress || isCancellingTask) && (
                  <EuiButton
                    onClick={cancelTask}
                    isDisabled={isCancellingTask}
                    data-test-subj="significant_events_cancel_discoveries_generation_button"
                  >
                    {isCancellingTask
                      ? i18n.translate('xpack.streams.discoveries.cancellingTaskButtonLabel', {
                          defaultMessage: 'Cancelling',
                        })
                      : i18n.translate('xpack.streams.discoveries.cancelTaskButtonLabel', {
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
