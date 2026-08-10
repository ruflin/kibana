/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo } from 'react';
import {
  EuiBasicTable,
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSpacer,
  EuiStat,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import type { EuiBasicTableColumn } from '@elastic/eui';
import { css } from '@emotion/react';
import { i18n } from '@kbn/i18n';
import type {
  SignificantEventsStatsResponse,
  SignificantEventsStatsToolRow,
  SignificantEventsStatsWorkflowTypeRow,
} from '@kbn/significant-events-plugin/common';
import { SignificantEventsSearchBar } from '../../../../components/search_bar';
import { useFetchStats } from '../../../../hooks/use_fetch_stats';
import { useTimefilter } from '../../../../hooks/use_timefilter';
import { StackedDailyChart, type StackedDailyPoint } from './stacked_daily_chart';

const formatNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);

const toChartPoints = (
  daily: SignificantEventsStatsResponse['daily'],
  getSeries: (day: SignificantEventsStatsResponse['daily'][number]) => Record<string, number>
): StackedDailyPoint[] => {
  const points: StackedDailyPoint[] = [];
  for (const day of daily) {
    const x = Date.parse(day.date);
    if (!Number.isFinite(x)) {
      continue;
    }
    for (const [g, y] of Object.entries(getSeries(day))) {
      if (y > 0) {
        points.push({ x, y, g });
      }
    }
  }
  return points;
};

const shortWorkflowLabel = (workflowId: string): string =>
  workflowId
    .replace(/^system-significant-events-/, '')
    .replace(/^system-streams-ki-/, 'ki-')
    .replace(/-/g, ' ');

export const StatsTab = () => {
  const { timeState } = useTimefilter();
  const rangeMs = timeState.end - timeState.start;
  const interval = rangeMs <= 2 * 24 * 60 * 60 * 1000 ? '1h' : '1d';

  const { data, isLoading, isError } = useFetchStats({
    from: timeState.start,
    to: timeState.end,
    interval,
  });

  const workflowChartData = useMemo(
    () => (data ? toChartPoints(data.daily, (day) => day.workflowRuns.byType) : []),
    [data]
  );
  const tokenChartData = useMemo(
    () =>
      data
        ? toChartPoints(data.daily, (day) => ({
            input: day.workflowRuns.tokens.input,
            output: day.workflowRuns.tokens.output,
            cached: day.workflowRuns.tokens.cached,
          }))
        : [],
    [data]
  );
  const toolChartData = useMemo(
    () => (data ? toChartPoints(data.daily, (day) => day.toolCalls.byTool) : []),
    [data]
  );
  const conversationChartData = useMemo(
    () => (data ? toChartPoints(data.daily, (day) => day.conversations.byAgent) : []),
    [data]
  );
  const artifactChartData = useMemo(
    () =>
      data
        ? toChartPoints(data.daily, (day) => ({
            events: day.artifacts.events,
            detections: day.artifacts.detections,
            knowledgeIndicators: day.artifacts.knowledgeIndicators,
            memories: day.artifacts.memories,
          }))
        : [],
    [data]
  );

  const workflowColumns: Array<EuiBasicTableColumn<SignificantEventsStatsWorkflowTypeRow>> =
    useMemo(
      () => [
        {
          field: 'workflowId',
          name: i18n.translate('xpack.significantEventsApp.statsTab.workflowColumn', {
            defaultMessage: 'Workflow',
          }),
          render: (workflowId: string) => shortWorkflowLabel(workflowId),
        },
        {
          field: 'runs',
          name: i18n.translate('xpack.significantEventsApp.statsTab.runsColumn', {
            defaultMessage: 'Runs',
          }),
          render: (runs: number) => formatNumber(runs),
        },
        {
          name: i18n.translate('xpack.significantEventsApp.statsTab.tokensColumn', {
            defaultMessage: 'Tokens (in / out / cached)',
          }),
          render: (_: unknown, row: SignificantEventsStatsWorkflowTypeRow) =>
            `${formatNumber(row.tokens.input)} / ${formatNumber(
              row.tokens.output
            )} / ${formatNumber(row.tokens.cached)}`,
        },
      ],
      []
    );

  const toolColumns: Array<EuiBasicTableColumn<SignificantEventsStatsToolRow>> = useMemo(
    () => [
      {
        field: 'toolId',
        name: i18n.translate('xpack.significantEventsApp.statsTab.toolColumn', {
          defaultMessage: 'Tool',
        }),
      },
      {
        field: 'calls',
        name: i18n.translate('xpack.significantEventsApp.statsTab.callsColumn', {
          defaultMessage: 'Calls',
        }),
        render: (calls: number) => formatNumber(calls),
      },
      {
        field: 'errors',
        name: i18n.translate('xpack.significantEventsApp.statsTab.errorsColumn', {
          defaultMessage: 'Errors',
        }),
        render: (errors: number) => formatNumber(errors),
      },
    ],
    []
  );

  return (
    <>
      <SignificantEventsSearchBar showDatePicker enableDateRangePicker />
      <EuiSpacer />

      {isLoading && (
        <EuiFlexGroup
          justifyContent="center"
          alignItems="center"
          css={css`
            min-height: 200px;
          `}
        >
          <EuiFlexItem grow={false}>
            <EuiLoadingSpinner size="xl" />
          </EuiFlexItem>
        </EuiFlexGroup>
      )}

      {isError && (
        <EuiCallOut
          announceOnMount
          color="danger"
          title={i18n.translate('xpack.significantEventsApp.statsTab.loadErrorTitle', {
            defaultMessage: 'Could not load stats',
          })}
        />
      )}

      {data && !isLoading && (
        <>
          <SourcesCallout sources={data.sources} />
          <EuiSpacer />

          <EuiTitle size="s">
            <h2>
              {i18n.translate('xpack.significantEventsApp.statsTab.totalsTitle', {
                defaultMessage: 'Totals for selected range',
              })}
            </h2>
          </EuiTitle>
          <EuiSpacer size="m" />
          <EuiFlexGroup wrap>
            <StatCard
              title={i18n.translate('xpack.significantEventsApp.statsTab.workflowRunsStat', {
                defaultMessage: 'Workflow runs',
              })}
              value={data.totals.workflowRuns}
            />
            <StatCard
              title={i18n.translate('xpack.significantEventsApp.statsTab.inputTokensStat', {
                defaultMessage: 'Input tokens',
              })}
              value={data.totals.tokens.input}
            />
            <StatCard
              title={i18n.translate('xpack.significantEventsApp.statsTab.outputTokensStat', {
                defaultMessage: 'Output tokens',
              })}
              value={data.totals.tokens.output}
            />
            <StatCard
              title={i18n.translate('xpack.significantEventsApp.statsTab.cachedTokensStat', {
                defaultMessage: 'Cached tokens',
              })}
              value={data.totals.tokens.cached}
            />
            <StatCard
              title={i18n.translate('xpack.significantEventsApp.statsTab.toolCallsStat', {
                defaultMessage: 'Tool calls',
              })}
              value={data.totals.toolCalls}
            />
            <StatCard
              title={i18n.translate('xpack.significantEventsApp.statsTab.conversationsStat', {
                defaultMessage: 'Conversations',
              })}
              value={data.totals.conversations}
            />
            <StatCard
              title={i18n.translate('xpack.significantEventsApp.statsTab.eventsStat', {
                defaultMessage: 'Significant events',
              })}
              value={data.totals.events}
            />
            <StatCard
              title={i18n.translate('xpack.significantEventsApp.statsTab.detectionsStat', {
                defaultMessage: 'Detections',
              })}
              value={data.totals.detections}
            />
            <StatCard
              title={i18n.translate('xpack.significantEventsApp.statsTab.kisStat', {
                defaultMessage: 'Knowledge indicators',
              })}
              value={data.totals.knowledgeIndicators}
            />
            <StatCard
              title={i18n.translate('xpack.significantEventsApp.statsTab.memoriesStat', {
                defaultMessage: 'Memories',
              })}
              value={data.totals.memories}
            />
          </EuiFlexGroup>

          <EuiSpacer size="l" />
          <StackedDailyChart
            title={i18n.translate('xpack.significantEventsApp.statsTab.workflowRunsChartTitle', {
              defaultMessage: 'Workflow runs per day',
            })}
            description={i18n.translate(
              'xpack.significantEventsApp.statsTab.workflowRunsChartDescription',
              {
                defaultMessage: 'Stacked by managed workflow type.',
              }
            )}
            data={workflowChartData}
          />

          <EuiSpacer />
          <StackedDailyChart
            title={i18n.translate('xpack.significantEventsApp.statsTab.tokensChartTitle', {
              defaultMessage: 'Token usage per day',
            })}
            description={i18n.translate(
              'xpack.significantEventsApp.statsTab.tokensChartDescription',
              {
                defaultMessage:
                  'From workflow execution usage. KI HTTP-step LLM calls may be undercounted until they report metadata.usage.',
              }
            )}
            data={tokenChartData}
          />

          <EuiSpacer />
          <StackedDailyChart
            title={i18n.translate('xpack.significantEventsApp.statsTab.toolCallsChartTitle', {
              defaultMessage: 'Tool calls per day',
            })}
            description={i18n.translate(
              'xpack.significantEventsApp.statsTab.toolCallsChartDescription',
              {
                defaultMessage:
                  'Agent Builder tool spans for significant-events agents. KI @kbn/streams-ai tools are not included.',
              }
            )}
            data={toolChartData}
          />

          <EuiSpacer />
          <StackedDailyChart
            title={i18n.translate('xpack.significantEventsApp.statsTab.conversationsChartTitle', {
              defaultMessage: 'Conversations per day',
            })}
            data={conversationChartData}
          />

          <EuiSpacer />
          <StackedDailyChart
            title={i18n.translate('xpack.significantEventsApp.statsTab.artifactsChartTitle', {
              defaultMessage: 'Artifacts touched per day',
            })}
            description={i18n.translate(
              'xpack.significantEventsApp.statsTab.artifactsChartDescription',
              {
                defaultMessage:
                  'Distinct events, detections, knowledge indicators, and memories with activity in each bucket.',
              }
            )}
            data={artifactChartData}
          />

          <EuiSpacer size="l" />
          <EuiFlexGroup gutterSize="l" wrap>
            <EuiFlexItem grow={2}>
              <EuiPanel hasBorder paddingSize="m">
                <EuiTitle size="xs">
                  <h3>
                    {i18n.translate('xpack.significantEventsApp.statsTab.workflowTypesTitle', {
                      defaultMessage: 'Workflow types',
                    })}
                  </h3>
                </EuiTitle>
                <EuiSpacer size="m" />
                <EuiBasicTable
                  items={data.workflowTypes}
                  columns={workflowColumns}
                  tableCaption={i18n.translate(
                    'xpack.significantEventsApp.statsTab.workflowTypesCaption',
                    { defaultMessage: 'Workflow run counts by type' }
                  )}
                />
              </EuiPanel>
            </EuiFlexItem>
            <EuiFlexItem grow={1}>
              <EuiPanel hasBorder paddingSize="m">
                <EuiTitle size="xs">
                  <h3>
                    {i18n.translate('xpack.significantEventsApp.statsTab.topToolsTitle', {
                      defaultMessage: 'Top tools',
                    })}
                  </h3>
                </EuiTitle>
                <EuiSpacer size="m" />
                <EuiBasicTable
                  items={data.topTools}
                  columns={toolColumns}
                  tableCaption={i18n.translate(
                    'xpack.significantEventsApp.statsTab.topToolsCaption',
                    { defaultMessage: 'Most frequently called tools' }
                  )}
                />
              </EuiPanel>
            </EuiFlexItem>
          </EuiFlexGroup>
        </>
      )}
    </>
  );
};

const StatCard = ({ title, value }: { title: string; value: number }) => (
  <EuiFlexItem
    grow={false}
    css={css`
      min-width: 160px;
    `}
  >
    <EuiPanel hasBorder paddingSize="m">
      <EuiStat title={formatNumber(value)} description={title} titleSize="m" reverse />
    </EuiPanel>
  </EuiFlexItem>
);

const SourcesCallout = ({ sources }: { sources: SignificantEventsStatsResponse['sources'] }) => {
  const unavailable: string[] = [];
  if (!sources.workflowsAvailable) {
    unavailable.push(
      i18n.translate('xpack.significantEventsApp.statsTab.sourceWorkflowsMissing', {
        defaultMessage: 'workflow executions index',
      })
    );
  }
  if (!sources.tracingEnabled) {
    unavailable.push(
      i18n.translate('xpack.significantEventsApp.statsTab.sourceTracingDisabled', {
        defaultMessage: 'Agent Builder tracing (disabled)',
      })
    );
  } else if (!sources.tracesAvailable) {
    unavailable.push(
      i18n.translate('xpack.significantEventsApp.statsTab.sourceTracesMissing', {
        defaultMessage: 'Agent Builder traces index',
      })
    );
  }
  if (!sources.conversationsAvailable) {
    unavailable.push(
      i18n.translate('xpack.significantEventsApp.statsTab.sourceConversationsMissing', {
        defaultMessage: 'conversations index',
      })
    );
  }

  if (unavailable.length === 0 && !sources.toolCallsTruncated) {
    return (
      <EuiText size="s" color="subdued">
        <p>
          {i18n.translate('xpack.significantEventsApp.statsTab.sourcesOk', {
            defaultMessage:
              'Totals cover the selected time range only. Token numbers come from workflow execution usage.',
          })}
        </p>
      </EuiText>
    );
  }

  return (
    <EuiCallOut
      announceOnMount
      color="warning"
      title={i18n.translate('xpack.significantEventsApp.statsTab.sourcesWarningTitle', {
        defaultMessage: 'Some stats sources are incomplete',
      })}
    >
      {unavailable.length > 0 && (
        <p>
          {i18n.translate('xpack.significantEventsApp.statsTab.sourcesWarningBody', {
            defaultMessage: 'Unavailable or disabled: {sources}.',
            values: { sources: unavailable.join(', ') },
          })}
        </p>
      )}
      {sources.toolCallsTruncated && (
        <p>
          {i18n.translate('xpack.significantEventsApp.statsTab.toolCallsTruncated', {
            defaultMessage:
              'Tool-call stats are based on a capped set of agent traces in this range and may be incomplete.',
          })}
        </p>
      )}
    </EuiCallOut>
  );
};
