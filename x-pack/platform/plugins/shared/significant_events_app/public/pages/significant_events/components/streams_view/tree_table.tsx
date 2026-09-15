/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import type { CriteriaWithPagination, Direction, Query } from '@elastic/eui';
import {
  EuiButtonIcon,
  EuiFlexGroup,
  EuiFlexItem,
  EuiHighlight,
  EuiIcon,
  EuiIconTip,
  EuiInMemoryTable,
  EuiLink,
  EuiLoadingSpinner,
  EuiToolTip,
  useEuiTheme,
} from '@elastic/eui';
import { css } from '@emotion/css';
import { i18n } from '@kbn/i18n';
import type { ListStreamDetail } from '@kbn/streams-plugin/server/routes/internal/streams/crud/route';
import { Streams } from '@kbn/streams-schema';
import {
  SignificantEventsWorkflowStatus,
  type SignificantEventsWorkflowStatusResult,
} from '@kbn/significant-events-schema';
import { STREAMS_APP_LOCATOR_ID } from '@kbn/deeplinks-observability';
import type { StreamsAppLocationParams } from '@kbn/streams-plugin/common';
import React, { useMemo, useState } from 'react';
import {
  STREAMS_HISTOGRAM_NUM_DATA_POINTS,
  useStreamHistogramFetch,
} from '../../../../hooks/use_stream_histogram_fetch';
import { useKibana } from '../../../../hooks/use_kibana';
import { useTimefilter } from '../../../../hooks/use_timefilter';
import { QueryStreamBadge, TechnicalPreviewBadge } from '../../../../components/badges';
import { DocumentsColumn } from './documents_column';
import { KnowledgeIndicatorsColumn } from './knowledge_indicators_column';
import { StreamEnabledSwitch } from './stream_enabled_switch';
import {
  DOCUMENTS_COLUMN_HEADER,
  ENABLED_COLUMN_HEADER,
  KNOWLEDGE_INDICATORS_COLUMN_HEADER,
  NAME_COLUMN_HEADER,
  NO_STREAMS_MESSAGE,
  ONBOARDING_STATUS_COLUMN_HEADER,
  STREAMS_TABLE_CAPTION_ARIA_LABEL,
} from './translations';
import type { SortableField, TableRow } from './utils';
import {
  asTrees,
  buildStreamRows,
  enrichStream,
  filterCollapsedStreamRows,
  filterStreamsByQuery,
} from './utils';

const EMPTY_CHILDREN: NonNullable<TableRow['children']> = [];

export function StreamsTreeTable({
  loading,
  streams = [],
  streamOnboardingResultMap,
  searchQuery,
  activityBlockTooltip,
  isStreamEnabled,
  isStreamToggleDisabled,
  onStreamEnabledChange,
}: {
  streams?: ListStreamDetail[];
  streamOnboardingResultMap: Record<string, SignificantEventsWorkflowStatusResult>;
  loading?: boolean;
  searchQuery: Query;
  /** Explains why the Enabled toggle is disabled (loading / error / paused). */
  activityBlockTooltip?: string;
  isStreamEnabled: (streamName: string) => boolean;
  isStreamToggleDisabled: (streamName: string, enabled: boolean) => boolean;
  onStreamEnabledChange: (streamName: string, enabled: boolean) => void;
}) {
  const {
    dependencies: {
      start: {
        share: {
          url: { locators },
        },
      },
    },
  } = useKibana();
  const streamsLocator = locators.get<StreamsAppLocationParams>(STREAMS_APP_LOCATOR_ID);
  const { euiTheme } = useEuiTheme();
  const { timeState } = useTimefilter();

  const privilegeMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const streamDetail of streams) {
      map.set(streamDetail.stream.name, streamDetail.privileges.read_failure_store);
    }
    return map;
  }, [streams]);

  const { getStreamHistogram } = useStreamHistogramFetch({
    getCanReadFailureStore: (streamName: string) => privilegeMap.get(streamName) ?? false,
    numDataPoints: STREAMS_HISTOGRAM_NUM_DATA_POINTS,
  });

  const [sortField, setSortField] = useState<SortableField>('nameSortKey');
  const [sortDirection, setSortDirection] = useState<Direction>('asc');
  // Collapsed state: Set of collapsed node names
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pagination, setPagination] = useState<{ pageIndex: number; pageSize: number }>({
    pageIndex: 0,
    pageSize: 25,
  });

  const filteredStreams = useMemo(() => {
    return filterStreamsByQuery(
      streams.filter(
        (stream) =>
          Streams.ingest.all.Definition.is(stream.stream) ||
          Streams.QueryStream.Definition.is(stream.stream)
      ),
      searchQuery.text
    );
  }, [streams, searchQuery]);

  const enrichedStreams = useMemo(
    () => asTrees(filteredStreams).map(enrichStream),
    [filteredStreams]
  );

  const allRows = useMemo(
    () => buildStreamRows(enrichedStreams, sortField, sortDirection),
    [enrichedStreams, sortField, sortDirection]
  );

  const items = useMemo(() => filterCollapsedStreamRows(allRows, collapsed), [allRows, collapsed]);

  const handleTableChange = ({ sort, page }: CriteriaWithPagination<TableRow>) => {
    if (sort) {
      setSortField(sort.field as SortableField);
      setSortDirection(sort.direction);
    }
    if (page) {
      setPagination({
        pageIndex: page.index,
        pageSize: page.size,
      });
    }
  };

  const handleToggleCollapse = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const allExpandableNodeNames = useMemo(() => {
    const names: string[] = [];
    for (const row of allRows) {
      if (row.children && row.children.length > 0) {
        names.push(row.stream.name);
      }
    }
    return names;
  }, [allRows]);

  const allExpanded = allExpandableNodeNames.every((name) => !collapsed.has(name));
  const hasExpandable = allExpandableNodeNames.length > 0;

  const handleExpandCollapseAll = () => {
    setCollapsed(() => (allExpanded ? new Set(allExpandableNodeNames) : new Set()));
  };

  const sorting = {
    sort: {
      field: sortField,
      direction: sortDirection,
    },
  };

  React.useEffect(() => {
    setPagination((prev) => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }));
  }, [streams, searchQuery, sortField, sortDirection]);

  const expandCollapseLabel = allExpanded
    ? i18n.translate('xpack.significantEventsApp.streamsTreeTable.collapseAll', {
        defaultMessage: 'Collapse all',
      })
    : i18n.translate('xpack.significantEventsApp.streamsTreeTable.expandAll', {
        defaultMessage: 'Expand all',
      });

  const nameColumnHeader = (
    <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
      {hasExpandable && (
        <EuiFlexItem grow={false}>
          <EuiToolTip content={expandCollapseLabel} disableScreenReaderOutput>
            <EuiButtonIcon
              size="xs"
              iconType={allExpanded ? 'fold' : 'unfold'}
              color="text"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                handleExpandCollapseAll();
              }}
              data-test-subj={`streams${allExpanded ? 'Collapse' : 'Expand'}AllButton`}
              aria-label={expandCollapseLabel}
            />
          </EuiToolTip>
        </EuiFlexItem>
      )}
      <EuiFlexItem>
        <span>{NAME_COLUMN_HEADER}</span>
      </EuiFlexItem>
    </EuiFlexGroup>
  );

  return (
    <EuiFlexGroup direction="column" gutterSize="m">
      <EuiFlexItem>
        <EuiInMemoryTable<TableRow>
          loading={loading}
          data-test-subj="streamsTable"
          columns={[
            {
              field: 'nameSortKey',
              name: nameColumnHeader,
              sortable: (row: TableRow) => row.rootNameSortKey,
              dataType: 'string',
              render: (_: unknown, item: TableRow) => {
                const children = item.children ?? EMPTY_CHILDREN;
                const hasChildren = children.length > 0;
                const isCollapsed = collapsed.has(item.stream.name);
                const isQueryStream = Streams.QueryStream.Definition.is(item.stream);

                return (
                  <EuiFlexGroup
                    alignItems="center"
                    gutterSize="s"
                    responsive={false}
                    className={css`
                      margin-left: ${item.level * parseInt(euiTheme.size.xl, 10)}px;
                    `}
                  >
                    {hasChildren ? (
                      <EuiFlexItem grow={false}>
                        <EuiIcon
                          type={isCollapsed ? 'chevronSingleRight' : 'chevronSingleDown'}
                          color="text"
                          size="m"
                          data-test-subj={`${isCollapsed ? 'expand' : 'collapse'}Button-${
                            item.stream.name
                          }`}
                          aria-label={i18n.translate(
                            isCollapsed
                              ? 'xpack.significantEventsApp.streamsTreeTable.collapsedNodeAriaLabel'
                              : 'xpack.significantEventsApp.streamsTreeTable.expandedNodeAriaLabel',
                            {
                              defaultMessage: isCollapsed
                                ? 'Collapsed node with {childCount} children'
                                : 'Expanded node with {childCount} children',
                              values: { childCount: children.length },
                            }
                          )}
                          onClick={() => {
                            handleToggleCollapse(item.stream.name);
                          }}
                          tabIndex={0}
                          role="button"
                          onKeyDown={(e: React.KeyboardEvent) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleToggleCollapse(item.stream.name);
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                      </EuiFlexItem>
                    ) : (
                      <EuiFlexItem grow={false}>
                        <EuiIcon type="empty" color="text" size="m" aria-hidden="true" />
                      </EuiFlexItem>
                    )}
                    {isQueryStream && (
                      <EuiFlexItem grow={false}>
                        <QueryStreamBadge />
                      </EuiFlexItem>
                    )}
                    <EuiFlexItem grow={false}>
                      <EuiLink
                        data-test-subj={`streamsNameLink-${item.stream.name}`}
                        href={streamsLocator?.getRedirectUrl({
                          name: item.stream.name,
                          managementTab: 'overview',
                        })}
                      >
                        <EuiHighlight search={searchQuery.text}>{item.stream.name}</EuiHighlight>
                      </EuiLink>
                    </EuiFlexItem>
                    {isQueryStream && (
                      <EuiFlexItem grow={false}>
                        <TechnicalPreviewBadge />
                      </EuiFlexItem>
                    )}
                  </EuiFlexGroup>
                );
              },
            },
            {
              name: DOCUMENTS_COLUMN_HEADER,
              width: '180px',
              align: 'right',
              render: (item: TableRow) => (
                <DocumentsColumn
                  indexPattern={item.stream.name}
                  histogramQueryFetch={getStreamHistogram(item.stream.name)}
                  timeState={timeState}
                  numDataPoints={STREAMS_HISTOGRAM_NUM_DATA_POINTS}
                />
              ),
            },
            {
              name: ENABLED_COLUMN_HEADER,
              width: '90px',
              align: 'left',
              render: (item: TableRow) => {
                const enabled = isStreamEnabled(item.stream.name);
                const toggleDisabled = isStreamToggleDisabled(item.stream.name, enabled);
                return (
                  <StreamEnabledSwitch
                    streamName={item.stream.name}
                    checked={enabled}
                    disabled={toggleDisabled}
                    disabledTooltip={toggleDisabled ? activityBlockTooltip : undefined}
                    onEnabledChange={onStreamEnabledChange}
                  />
                );
              },
            },
            {
              name: ONBOARDING_STATUS_COLUMN_HEADER,
              width: '120px',
              align: 'left',
              render: (item: TableRow) => {
                const onboardingResult = streamOnboardingResultMap[item.stream.name];

                if (onboardingResult === undefined) {
                  return '-';
                }

                switch (onboardingResult.status) {
                  case SignificantEventsWorkflowStatus.InProgress:
                  case SignificantEventsWorkflowStatus.BeingCanceled:
                    return <EuiLoadingSpinner size="m" />;
                  case SignificantEventsWorkflowStatus.NotStarted:
                  case SignificantEventsWorkflowStatus.Canceled:
                    return '-';
                  case SignificantEventsWorkflowStatus.Completed:
                    return (
                      <EuiIcon type="checkCircleFill" color="success" size="m" aria-hidden={true} />
                    );
                  case SignificantEventsWorkflowStatus.Failed:
                    return (
                      <EuiIconTip
                        size="m"
                        type="crossCircle"
                        color="danger"
                        content={onboardingResult.error}
                      />
                    );
                }
              },
            },
            {
              name: KNOWLEDGE_INDICATORS_COLUMN_HEADER,
              width: '120px',
              align: 'left',
              render: (item: TableRow) => (
                <KnowledgeIndicatorsColumn
                  stream={item.stream}
                  streamOnboardingResult={streamOnboardingResultMap[item.stream.name]}
                />
              ),
            },
          ]}
          itemId="nameSortKey"
          items={items}
          sorting={sorting}
          noItemsMessage={NO_STREAMS_MESSAGE}
          onTableChange={handleTableChange}
          pagination={{
            initialPageSize: 25,
            pageSizeOptions: [25, 50, 100],
            pageIndex: pagination.pageIndex,
            pageSize: pagination.pageSize,
          }}
          tableCaption={STREAMS_TABLE_CAPTION_ARIA_LABEL}
        />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}
