/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EuiSearchBarProps, Query } from '@elastic/eui';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSearchBar,
  EuiText,
} from '@elastic/eui';
import { css } from '@emotion/react';
import { i18n } from '@kbn/i18n';
import { toMountPoint } from '@kbn/react-kibana-mount';
import type { OnboardingResult, TaskResult } from '@kbn/streams-schema';
import { TaskStatus } from '@kbn/streams-schema';
import pMap from 'p-map';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import useAsyncFn from 'react-use/lib/useAsyncFn';
import type { TableRow } from './utils';
import { useAIFeatures } from '../../../../hooks/use_ai_features';
import { useKibana } from '../../../../hooks/use_kibana';
import { useDiscoveryPipelineApi } from '../../../../hooks/use_discovery_pipeline_api';
import { useOnboardingApi } from '../../../../hooks/use_onboarding_api';
import { useStreamsAppRouter } from '../../../../hooks/use_streams_app_router';
import { useTaskPolling } from '../../../../hooks/use_task_polling';
import { getFormattedError } from '../../../../util/errors';
import { StreamsAppSearchBar } from '../../../streams_app_search_bar';
import { useStreamsAppFetch } from '../../../../hooks/use_streams_app_fetch';
import { useOnboardingStatusUpdateQueue } from '../../hooks/use_onboarding_status_update_queue';
import {
  DISCOVER_DISCOVERIES_BUTTON_LABEL,
  getDiscoveriesCompleteToastTitle,
  DISCOVERIES_COMPLETE_TOAST_VIEW_BUTTON,
  DISCOVERIES_SCHEDULING_FAILURE_TITLE,
  NO_DISCOVERIES_TOAST_TITLE,
  ONBOARDING_FAILURE_TITLE,
  ONBOARDING_SCHEDULING_FAILURE_TITLE,
  RUN_BULK_STREAM_ONBOARDING_BUTTON_LABEL,
  STREAMS_TABLE_SEARCH_ARIA_LABEL,
} from './translations';
import { StreamsTreeTable } from './tree_table';
import { useFetchStreams } from '../../hooks/use_fetch_streams';

const datePickerStyle = css`
  .euiFormControlLayout,
  .euiSuperDatePicker button,
  .euiButton {
    height: 40px;
  }
`;

interface StreamsViewProps {
  refreshUnbackedQueriesCount: () => void;
}

export function StreamsView({ refreshUnbackedQueriesCount }: StreamsViewProps) {
  const {
    core,
    core: {
      notifications: { toasts },
    },
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();
  const isInitialStatusUpdateDone = useRef(false);
  const [searchQuery, setSearchQuery] = useState<Query | undefined>();
  const [isWaitingForDiscoveriesTask, setIsWaitingForDiscoveriesTask] = useState(false);

  const discoverySettingsFetch = useStreamsAppFetch(
    async ({ signal }) =>
      streamsRepositoryClient.fetch('GET /internal/streams/_discovery/_settings', { signal }),
    [streamsRepositoryClient]
  );

  const enableMetricsTraces = discoverySettingsFetch.value?.enableMetricsTraces ?? false;

  const streamsListFetch = useFetchStreams({
    select: (result) => {
      return {
        ...result,
        streams: result.streams.filter((stream) => {
          if (stream.stream.name.startsWith('logs')) return true;
          if (enableMetricsTraces) {
            return (
              stream.stream.name.startsWith('metrics') || stream.stream.name.startsWith('traces')
            );
          }
          return false;
        }),
      };
    },
  });

  const [selectedStreams, setSelectedStreams] = useState<TableRow[]>([]);
  const [streamOnboardingResultMap, setStreamOnboardingResultMap] = useState<
    Record<string, TaskResult<OnboardingResult>>
  >({});
  const router = useStreamsAppRouter();
  const aiFeatures = useAIFeatures();
  const { scheduleOnboardingTask, cancelOnboardingTask } = useOnboardingApi({
    connectorId: aiFeatures?.genAiConnectors.selectedConnector,
  });
  const { scheduleDiscoveryPipelineTask, getDiscoveryPipelineTaskStatus } = useDiscoveryPipelineApi(
    aiFeatures?.genAiConnectors.selectedConnector
  );
  const [{ value: discoveriesTask }, getDiscoveriesTaskStatus] = useAsyncFn(
    getDiscoveryPipelineTaskStatus
  );
  useTaskPolling({
    task: discoveriesTask,
    onPoll: getDiscoveryPipelineTaskStatus,
    onRefresh: getDiscoveriesTaskStatus,
  });

  const [{ loading: isSchedulingDiscoveries }, scheduleDiscoveriesTask] = useAsyncFn(async () => {
    const streamNames =
      selectedStreams.length > 0 ? selectedStreams.map((row) => row.stream.name) : undefined;
    try {
      await scheduleDiscoveryPipelineTask(streamNames);
      setIsWaitingForDiscoveriesTask(true);
      await getDiscoveriesTaskStatus();
    } catch (error) {
      toasts.addError(getFormattedError(error), {
        title: DISCOVERIES_SCHEDULING_FAILURE_TITLE,
      });
      throw error;
    }
  }, [scheduleDiscoveryPipelineTask, selectedStreams, toasts, getDiscoveriesTaskStatus]);

  // When we started the discoveries task from this view and it completes, show toast
  useEffect(() => {
    if (!isWaitingForDiscoveriesTask || !discoveriesTask) return;
    if (
      discoveriesTask.status !== TaskStatus.Completed &&
      discoveriesTask.status !== TaskStatus.Failed
    ) {
      return;
    }
    setIsWaitingForDiscoveriesTask(false);
    if (discoveriesTask.status === TaskStatus.Failed) {
      toasts.addError(getFormattedError(new Error(discoveriesTask.error)), {
        title: DISCOVERIES_SCHEDULING_FAILURE_TITLE,
      });
      return;
    }
    if (discoveriesTask.status === TaskStatus.Completed) {
      const count = discoveriesTask.discoveries?.length ?? 0;
      if (count === 0) {
        toasts.addInfo({
          title: NO_DISCOVERIES_TOAST_TITLE,
        });
      } else {
        const toast = toasts.addSuccess({
          title: getDiscoveriesCompleteToastTitle(count),
          text: toMountPoint(
            <EuiFlexGroup justifyContent="flexEnd" gutterSize="s">
              <EuiFlexItem grow={false}>
                <EuiButton
                  size="s"
                  data-test-subj="significant_events_view_discoveries_toast_button"
                  onClick={() => {
                    toasts.remove(toast);
                    router.push('/_discovery/{tab}', {
                      path: { tab: 'discoveries' },
                      query: {},
                    });
                  }}
                >
                  {DISCOVERIES_COMPLETE_TOAST_VIEW_BUTTON}
                </EuiButton>
              </EuiFlexItem>
            </EuiFlexGroup>,
            core
          ),
        });
      }
    }
  }, [isWaitingForDiscoveriesTask, discoveriesTask, toasts, router, core]);

  const onStreamStatusUpdate = useCallback(
    (streamName: string, taskResult: TaskResult<OnboardingResult>) => {
      setStreamOnboardingResultMap((currentMap) => ({
        ...currentMap,
        [streamName]: taskResult,
      }));

      /**
       * Preventing showing error toasts and doing extra work
       * for the initial status update when the page loads for
       * the first time
       */
      if (!isInitialStatusUpdateDone.current) {
        return;
      }

      if (taskResult.status === TaskStatus.Failed) {
        toasts.addError(getFormattedError(new Error(taskResult.error)), {
          title: ONBOARDING_FAILURE_TITLE,
        });
      }

      if (taskResult.status === TaskStatus.Completed) {
        refreshUnbackedQueriesCount();
      }
    },
    [refreshUnbackedQueriesCount, toasts]
  );
  const { onboardingStatusUpdateQueue, processStatusUpdateQueue } =
    useOnboardingStatusUpdateQueue(onStreamStatusUpdate);

  const handleQueryChange: EuiSearchBarProps['onChange'] = ({ query }) => {
    if (query) setSearchQuery(query);
  };

  useEffect(() => {
    if (streamsListFetch.data === undefined) {
      return;
    }

    streamsListFetch.data.streams.forEach((item) => {
      onboardingStatusUpdateQueue.add(item.stream.name);
    });
    processStatusUpdateQueue().finally(() => {
      isInitialStatusUpdateDone.current = true;
    });
  }, [onboardingStatusUpdateQueue, processStatusUpdateQueue, streamsListFetch.data]);

  const bulkScheduleOnboardingTask = async (streamList: string[]) => {
    try {
      await pMap(
        streamList,
        async (streamName) => {
          await scheduleOnboardingTask(streamName);
        },
        { concurrency: 10 }
      );
    } catch (error) {
      toasts.addError(getFormattedError(error), {
        title: ONBOARDING_SCHEDULING_FAILURE_TITLE,
      });
    }
  };

  const onBulkOnboardStreamsClick = async () => {
    const streamList = selectedStreams
      .filter((item) => {
        const onboardingResult = streamOnboardingResultMap[item.stream.name];

        return ![TaskStatus.InProgress, TaskStatus.BeingCanceled].includes(onboardingResult.status);
      })
      .map((item) => item.stream.name);

    setSelectedStreams([]);

    await bulkScheduleOnboardingTask(streamList);
    streamList.forEach((streamName) => {
      onboardingStatusUpdateQueue.add(streamName);
    });
    processStatusUpdateQueue();
  };

  const onOnboardStreamActionClick = async (streamName: string) => {
    await bulkScheduleOnboardingTask([streamName]);

    onboardingStatusUpdateQueue.add(streamName);
    processStatusUpdateQueue();
  };

  const onStopOnboardingActionClick = (streamName: string) => {
    cancelOnboardingTask(streamName);
  };

  return (
    <EuiFlexGroup direction="column" gutterSize="m">
      <EuiFlexItem grow={false}>
        <EuiFlexGroup gutterSize="s" alignItems="center">
          <EuiFlexItem>
            <EuiSearchBar
              query={searchQuery}
              onChange={handleQueryChange}
              box={{
                incremental: true,
                'aria-label': STREAMS_TABLE_SEARCH_ARIA_LABEL,
              }}
            />
          </EuiFlexItem>
          <EuiFlexItem grow={false} css={datePickerStyle}>
            <StreamsAppSearchBar showDatePicker />
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>

      <EuiFlexItem grow={false}>
        <EuiFlexGroup alignItems="center" gutterSize="s">
          <EuiText size="s">
            {i18n.translate(
              'xpack.streams.significantEventsDiscovery.streamsTree.streamsCountLabel',
              {
                defaultMessage: '{count} streams',
                values: { count: streamsListFetch.data?.streams.length ?? 0 },
              }
            )}
          </EuiText>

          <EuiButtonEmpty
            onClick={onBulkOnboardStreamsClick}
            iconType="securitySignal"
            disabled={selectedStreams.length === 0}
          >
            {RUN_BULK_STREAM_ONBOARDING_BUTTON_LABEL}
          </EuiButtonEmpty>

          <EuiButtonEmpty
            iconType="crosshairs"
            onClick={() => scheduleDiscoveriesTask()}
            disabled={!aiFeatures?.genAiConnectors?.connectors?.length}
            isLoading={isSchedulingDiscoveries || isWaitingForDiscoveriesTask}
            data-test-subj="significant_events_discover_discoveries_button"
          >
            {DISCOVER_DISCOVERIES_BUTTON_LABEL}
          </EuiButtonEmpty>
        </EuiFlexGroup>
      </EuiFlexItem>

      <EuiFlexItem>
        <StreamsTreeTable
          streams={streamsListFetch.data?.streams}
          streamOnboardingResultMap={streamOnboardingResultMap}
          loading={streamsListFetch.isLoading}
          searchQuery={searchQuery}
          selection={{ selected: selectedStreams, onSelectionChange: setSelectedStreams }}
          onOnboardStreamActionClick={onOnboardStreamActionClick}
          onStopOnboardingActionClick={onStopOnboardingActionClick}
        />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}
