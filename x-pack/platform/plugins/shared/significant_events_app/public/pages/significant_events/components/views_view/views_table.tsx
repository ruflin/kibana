/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  EuiBadge,
  EuiBasicTable,
  EuiButtonIcon,
  EuiSwitch,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import type { EuiBasicTableColumn } from '@elastic/eui';
import type { SignificantEventsDataView } from '@kbn/significant-events-schema';
import type { SignificantEventsWorkflowStatusResult } from '@kbn/significant-events-schema';
import React, { useMemo } from 'react';
import { KnowledgeIndicatorsColumn } from '../streams_view/knowledge_indicators_column';
import { QueriesColumn } from '../streams_view/queries_column';
import { SignificantEventsColumn } from '../streams_view/significant_events_column';
import { toSyntheticQueryStream } from './to_synthetic_query_stream';
import {
  ENABLED_COLUMN_HEADER,
  NAME_COLUMN_HEADER,
  NO_VIEWS_MESSAGE,
  OWNED_BADGE,
  REMOVE_VIEW_LABEL,
  ENABLE_VIEW_LABEL,
} from './translations';
import {
  KNOWLEDGE_INDICATORS_COLUMN_HEADER,
  QUERIES_COLUMN_HEADER,
  SIGNIFICANT_EVENTS_COLUMN_HEADER,
} from '../streams_view/translations';

interface ViewsTableProps {
  views: SignificantEventsDataView[];
  searchText: string;
  loading: boolean;
  streamStatusMap: Record<string, SignificantEventsWorkflowStatusResult>;
  canManage: boolean;
  onToggle: (name: string, enabled: boolean) => void;
  onRemove: (name: string) => void;
}

export function ViewsTable({
  views,
  searchText,
  loading,
  streamStatusMap,
  canManage,
  onToggle,
  onRemove,
}: ViewsTableProps) {
  const items = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return views;
    return views.filter((view) => view.name.toLowerCase().includes(query));
  }, [views, searchText]);

  const columns: Array<EuiBasicTableColumn<SignificantEventsDataView>> = [
    {
      field: 'enabled',
      name: ENABLED_COLUMN_HEADER,
      width: '80px',
      render: (_enabled: boolean, view: SignificantEventsDataView) => (
        <EuiToolTip content={ENABLE_VIEW_LABEL}>
          <EuiSwitch
            compressed
            label={ENABLE_VIEW_LABEL}
            showLabel={false}
            checked={view.enabled}
            disabled={!canManage}
            onChange={(event) => onToggle(view.name, event.target.checked)}
            data-test-subj={`significantEventsViewEnabled-${view.name}`}
          />
        </EuiToolTip>
      ),
    },
    {
      field: 'name',
      name: NAME_COLUMN_HEADER,
      render: (name: string, view: SignificantEventsDataView) => (
        <EuiText size="s">
          <code>{name}</code>
          {view.owned && (
            <>
              {' '}
              <EuiBadge color="hollow">{OWNED_BADGE}</EuiBadge>
            </>
          )}
        </EuiText>
      ),
    },
    {
      name: KNOWLEDGE_INDICATORS_COLUMN_HEADER,
      width: '120px',
      render: (view: SignificantEventsDataView) => (
        <KnowledgeIndicatorsColumn
          stream={toSyntheticQueryStream(view)}
          streamOnboardingResult={streamStatusMap[view.name]}
        />
      ),
    },
    {
      name: QUERIES_COLUMN_HEADER,
      width: '120px',
      render: (view: SignificantEventsDataView) => (
        <QueriesColumn
          streamName={view.name}
          streamOnboardingResult={streamStatusMap[view.name]}
        />
      ),
    },
    {
      name: SIGNIFICANT_EVENTS_COLUMN_HEADER,
      width: '180px',
      render: (view: SignificantEventsDataView) => (
        <SignificantEventsColumn streamName={view.name} />
      ),
    },
    {
      width: '40px',
      render: (view: SignificantEventsDataView) =>
        canManage ? (
          <EuiButtonIcon
            iconType="trash"
            color="danger"
            aria-label={REMOVE_VIEW_LABEL}
            onClick={() => onRemove(view.name)}
            data-test-subj={`significantEventsViewRemove-${view.name}`}
          />
        ) : null,
    },
  ];

  return (
    <EuiBasicTable
      data-test-subj="significantEventsViewsTable"
      items={items}
      columns={columns}
      loading={loading}
      noItemsMessage={NO_VIEWS_MESSAGE}
      rowHeader="name"
    />
  );
}
