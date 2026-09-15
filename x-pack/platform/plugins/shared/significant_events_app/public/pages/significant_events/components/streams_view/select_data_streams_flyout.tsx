/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EuiBasicTableColumn, EuiTableSelectionType } from '@elastic/eui';
import {
  EuiButton,
  EuiButtonEmpty,
  EuiCallOut,
  EuiFieldText,
  EuiFlexGroup,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiFlyoutHeader,
  EuiForm,
  EuiFormRow,
  EuiInMemoryTable,
  EuiSpacer,
  EuiTab,
  EuiTabs,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { useQueryClient } from '@kbn/react-query';
import React, { useCallback, useMemo, useState } from 'react';
import { useKibana } from '../../../../hooks/use_kibana';
import { STREAM_LIST_QUERY_KEY } from '../../hooks/use_fetch_streams';
import { getFormattedError } from '../../../../util/errors';
import {
  buildQueryStreamEsqlFromDataStreams,
  type DataStreamSignalType,
  type ElasticsearchDataStream,
} from './build_query_stream_from_data_streams';
import {
  CREATE_QUERY_STREAM_CANCEL_LABEL,
  CREATE_QUERY_STREAM_ERROR_TITLE,
  CREATE_QUERY_STREAM_NAME_LABEL,
  CREATE_QUERY_STREAM_NAME_REQUIRED,
  CREATE_QUERY_STREAM_SUCCESS_TITLE,
  SELECT_DATA_STREAMS_DESCRIPTION,
  SELECT_DATA_STREAMS_EMPTY_MESSAGE,
  SELECT_DATA_STREAMS_FLYOUT_TITLE,
  SELECT_DATA_STREAMS_LOAD_ERROR_TITLE,
  SELECT_DATA_STREAMS_LOGS_AND_METRICS_TAB,
  SELECT_DATA_STREAMS_NAME_COLUMN,
  SELECT_DATA_STREAMS_OTHER_TAB,
  SELECT_DATA_STREAMS_SAVE_LABEL,
  SELECT_DATA_STREAMS_SEARCH_PLACEHOLDER,
  SELECT_DATA_STREAMS_SELECTION_REQUIRED,
  SELECT_DATA_STREAMS_TABLE_CAPTION,
  SELECT_DATA_STREAMS_TYPE_COLUMN,
  SELECT_DATA_STREAMS_TYPE_LOGS,
  SELECT_DATA_STREAMS_TYPE_METRICS,
  SELECT_DATA_STREAMS_TYPE_OTHER,
  getSelectDataStreamsSelectedCountLabel,
} from './translations';
import { useFetchElasticsearchDataStreams } from './use_fetch_elasticsearch_data_streams';

const NAME_MAX_LENGTH = 255;

type SelectDataStreamsTab = 'logsAndMetrics' | 'other';

const TYPE_LABELS: Record<DataStreamSignalType, string> = {
  logs: SELECT_DATA_STREAMS_TYPE_LOGS,
  metrics: SELECT_DATA_STREAMS_TYPE_METRICS,
  other: SELECT_DATA_STREAMS_TYPE_OTHER,
};

const isLogsOrMetrics = (type: DataStreamSignalType): boolean =>
  type === 'logs' || type === 'metrics';

interface SelectDataStreamsFlyoutProps {
  onClose: () => void;
}

export function SelectDataStreamsFlyout({ onClose }: SelectDataStreamsFlyoutProps) {
  const {
    core: {
      notifications: { toasts },
    },
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();
  const queryClient = useQueryClient();
  const { data: dataStreams = [], isLoading, error: loadError } = useFetchElasticsearchDataStreams();

  const [name, setName] = useState('');
  const [selectedNames, setSelectedNames] = useState<Set<string>>(() => new Set());
  const [activeTab, setActiveTab] = useState<SelectDataStreamsTab>('logsAndMetrics');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const logsAndMetrics = useMemo(
    () => dataStreams.filter((dataStream) => isLogsOrMetrics(dataStream.type)),
    [dataStreams]
  );
  const otherDataStreams = useMemo(
    () => dataStreams.filter((dataStream) => dataStream.type === 'other'),
    [dataStreams]
  );
  const visibleDataStreams = activeTab === 'logsAndMetrics' ? logsAndMetrics : otherDataStreams;
  const showOtherTab = otherDataStreams.length > 0;

  const trimmedName = name.trim();
  const nameError = submitted && !trimmedName ? CREATE_QUERY_STREAM_NAME_REQUIRED : undefined;
  const selectionError =
    submitted && selectedNames.size === 0 ? SELECT_DATA_STREAMS_SELECTION_REQUIRED : undefined;

  const selectedItems = useMemo(
    () => visibleDataStreams.filter((dataStream) => selectedNames.has(dataStream.name)),
    [selectedNames, visibleDataStreams]
  );

  const columns = useMemo<Array<EuiBasicTableColumn<ElasticsearchDataStream>>>(
    () => [
      {
        field: 'name',
        name: SELECT_DATA_STREAMS_NAME_COLUMN,
        truncateText: true,
      },
      {
        field: 'type',
        name: SELECT_DATA_STREAMS_TYPE_COLUMN,
        width: '120px',
        render: (type: DataStreamSignalType) => TYPE_LABELS[type],
      },
    ],
    []
  );

  const selection = useMemo<EuiTableSelectionType<ElasticsearchDataStream>>(
    () => ({
      selectable: () => true,
      onSelectionChange: (selected) => {
        const visibleNames = new Set(visibleDataStreams.map((dataStream) => dataStream.name));
        setSelectedNames((current) => {
          const next = new Set(current);
          visibleNames.forEach((streamName) => {
            next.delete(streamName);
          });
          selected.forEach((dataStream) => {
            next.add(dataStream.name);
          });
          return next;
        });
      },
      selected: selectedItems,
    }),
    [selectedItems, visibleDataStreams]
  );

  const handleSubmit = useCallback(async () => {
    setSubmitted(true);
    if (!trimmedName || selectedNames.size === 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const esql = buildQueryStreamEsqlFromDataStreams([...selectedNames]);
      await streamsRepositoryClient.fetch('PUT /api/streams/{name}/_query 2023-10-31', {
        params: {
          path: { name: trimmedName },
          body: { query: { esql } },
        },
        signal: null,
      });
      await queryClient.invalidateQueries({ queryKey: STREAM_LIST_QUERY_KEY });
      toasts.addSuccess({
        title: CREATE_QUERY_STREAM_SUCCESS_TITLE,
        toastLifeTimeMs: 3000,
      });
      onClose();
    } catch (error) {
      toasts.addDanger({
        title: CREATE_QUERY_STREAM_ERROR_TITLE,
        text: getFormattedError(error).message,
        toastLifeTimeMs: 3000,
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [onClose, queryClient, selectedNames, streamsRepositoryClient, toasts, trimmedName]);

  return (
    <EuiFlyout
      size="m"
      onClose={onClose}
      ownFocus
      aria-labelledby="significantEventsSelectDataStreamsFlyoutTitle"
      data-test-subj="significantEventsSelectDataStreamsFlyout"
    >
      <EuiFlyoutHeader hasBorder>
        <EuiTitle>
          <h2 id="significantEventsSelectDataStreamsFlyoutTitle">
            {SELECT_DATA_STREAMS_FLYOUT_TITLE}
          </h2>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiTabs size="s">
          <EuiTab
            isSelected={activeTab === 'logsAndMetrics'}
            onClick={() => setActiveTab('logsAndMetrics')}
            data-test-subj="significantEventsSelectDataStreamsLogsAndMetricsTab"
          >
            {SELECT_DATA_STREAMS_LOGS_AND_METRICS_TAB}
          </EuiTab>
          {showOtherTab && (
            <EuiTab
              isSelected={activeTab === 'other'}
              onClick={() => setActiveTab('other')}
              data-test-subj="significantEventsSelectDataStreamsOtherTab"
            >
              {SELECT_DATA_STREAMS_OTHER_TAB}
            </EuiTab>
          )}
        </EuiTabs>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiText size="s">
          <p>{SELECT_DATA_STREAMS_DESCRIPTION}</p>
        </EuiText>
        <EuiSpacer size="m" />
        <EuiForm component="div">
          <EuiFormRow
            label={CREATE_QUERY_STREAM_NAME_LABEL}
            isInvalid={Boolean(nameError)}
            error={nameError}
          >
            <EuiFieldText
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={NAME_MAX_LENGTH}
              isInvalid={Boolean(nameError)}
              data-test-subj="significantEventsSelectDataStreamsName"
            />
          </EuiFormRow>
          <EuiFormRow
            isInvalid={Boolean(selectionError)}
            error={selectionError}
            fullWidth
            label={getSelectDataStreamsSelectedCountLabel(selectedNames.size)}
          >
            {loadError ? (
              <EuiCallOut
                title={SELECT_DATA_STREAMS_LOAD_ERROR_TITLE}
                color="danger"
                size="s"
                data-test-subj="significantEventsSelectDataStreamsLoadError"
              >
                {getFormattedError(loadError).message}
              </EuiCallOut>
            ) : (
              <EuiInMemoryTable<ElasticsearchDataStream>
                tableCaption={SELECT_DATA_STREAMS_TABLE_CAPTION}
                items={visibleDataStreams}
                itemId="name"
                columns={columns}
                loading={isLoading}
                selection={selection}
                sorting={{ sort: { field: 'name', direction: 'asc' } }}
                search={{
                  box: {
                    incremental: true,
                    placeholder: SELECT_DATA_STREAMS_SEARCH_PLACEHOLDER,
                    'data-test-subj': 'significantEventsSelectDataStreamsSearch',
                  },
                }}
                message={SELECT_DATA_STREAMS_EMPTY_MESSAGE}
                data-test-subj="significantEventsSelectDataStreamsTable"
              />
            )}
          </EuiFormRow>
        </EuiForm>
      </EuiFlyoutBody>
      <EuiFlyoutFooter>
        <EuiFlexGroup justifyContent="spaceBetween">
          <EuiButtonEmpty
            onClick={onClose}
            flush="left"
            data-test-subj="significantEventsSelectDataStreamsCancel"
          >
            {CREATE_QUERY_STREAM_CANCEL_LABEL}
          </EuiButtonEmpty>
          <EuiButton
            fill
            onClick={() => {
              void handleSubmit();
            }}
            isLoading={isSubmitting}
            data-test-subj="significantEventsSelectDataStreamsSave"
          >
            {SELECT_DATA_STREAMS_SAVE_LABEL}
          </EuiButton>
        </EuiFlexGroup>
      </EuiFlyoutFooter>
    </EuiFlyout>
  );
}
