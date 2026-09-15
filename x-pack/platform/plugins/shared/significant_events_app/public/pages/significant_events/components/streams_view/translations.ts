/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { i18n } from '@kbn/i18n';

export const NAME_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.streamsTreeTable.nameColumnName',
  {
    defaultMessage: 'Name',
  }
);

export const DOCUMENTS_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.streamsTreeTable.documentsColumnName',
  {
    defaultMessage: 'Documents',
  }
);

export const KNOWLEDGE_INDICATORS_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.streamsTree.knowledgeIndicatorsColumnName',
  {
    defaultMessage: 'KI Features',
  }
);

export const ENABLED_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.streamsTree.enabledColumnName',
  {
    defaultMessage: 'Enabled',
  }
);

export const ONBOARDING_STATUS_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.streamsTree.onboardingStatusColumnName',
  {
    defaultMessage: 'Status',
  }
);

export const getEnableStreamToggleAriaLabel = (streamName: string): string =>
  i18n.translate('xpack.significantEventsApp.streamsTree.enableStreamToggleSwitch', {
    defaultMessage: 'Enable {streamName} for Nightshift knowledge indicator extraction',
    values: { streamName },
  });

export const NO_STREAMS_MESSAGE = i18n.translate(
  'xpack.significantEventsApp.streamsTree.noStreamsMessage',
  {
    defaultMessage: 'No streams found.',
  }
);

export const STREAMS_TABLE_SEARCH_ARIA_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsTree.searchAriaLabel',
  { defaultMessage: 'Search streams by name' }
);

export const STREAMS_TABLE_CAPTION_ARIA_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsTree.tableCaptionAriaLabel',
  {
    defaultMessage: 'Streams data table, listing stream names with links',
  }
);

export const ONBOARDING_FAILURE_TITLE = i18n.translate(
  'xpack.significantEventsApp.streamsView.onboardingErrorTitle',
  {
    defaultMessage: 'Could not onboard stream',
  }
);

export const ADD_DATA_SOURCE_BUTTON_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsView.addDataSourceButtonLabel',
  {
    defaultMessage: 'Add Data Source',
  }
);

export const ADD_DATA_SOURCE_POPOVER_ARIA_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsView.addDataSourcePopoverAriaLabel',
  {
    defaultMessage: 'Add data source options',
  }
);

export const ADD_QUERY_STREAM_MENU_ITEM_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsView.addQueryStreamMenuItemLabel',
  {
    defaultMessage: 'Query stream',
  }
);

export const CREATE_QUERY_STREAM_FLYOUT_TITLE = i18n.translate(
  'xpack.significantEventsApp.streamsView.createQueryStreamFlyoutTitle',
  {
    defaultMessage: 'Create query stream',
  }
);

export const CREATE_QUERY_STREAM_NAME_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsView.createQueryStreamNameLabel',
  {
    defaultMessage: 'Stream name',
  }
);

export const CREATE_QUERY_STREAM_QUERY_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsView.createQueryStreamQueryLabel',
  {
    defaultMessage: 'ES|QL query',
  }
);

export const CREATE_QUERY_STREAM_DESCRIPTION = i18n.translate(
  'xpack.significantEventsApp.streamsView.createQueryStreamDescription',
  {
    defaultMessage: 'Use ES|QL to define a query stream as a Nightshift data source.',
  }
);

export const CREATE_QUERY_STREAM_SAVE_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsView.createQueryStreamSaveLabel',
  {
    defaultMessage: 'Create query stream',
  }
);

export const CREATE_QUERY_STREAM_CANCEL_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsView.createQueryStreamCancelLabel',
  {
    defaultMessage: 'Cancel',
  }
);

export const CREATE_QUERY_STREAM_SUCCESS_TITLE = i18n.translate(
  'xpack.significantEventsApp.streamsView.createQueryStreamSuccessTitle',
  {
    defaultMessage: 'Query stream created',
  }
);

export const CREATE_QUERY_STREAM_ERROR_TITLE = i18n.translate(
  'xpack.significantEventsApp.streamsView.createQueryStreamErrorTitle',
  {
    defaultMessage: 'Error creating query stream',
  }
);

export const CREATE_QUERY_STREAM_NAME_REQUIRED = i18n.translate(
  'xpack.significantEventsApp.streamsView.createQueryStreamNameRequired',
  {
    defaultMessage: 'Name is required',
  }
);

export const CREATE_QUERY_STREAM_QUERY_REQUIRED = i18n.translate(
  'xpack.significantEventsApp.streamsView.createQueryStreamQueryRequired',
  {
    defaultMessage: 'Query is required',
  }
);

export const ADD_SELECT_DATA_STREAMS_MENU_ITEM_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsView.addSelectDataStreamsMenuItemLabel',
  {
    defaultMessage: 'Select data streams',
  }
);

export const SELECT_DATA_STREAMS_FLYOUT_TITLE = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsFlyoutTitle',
  {
    defaultMessage: 'Select data streams',
  }
);

export const SELECT_DATA_STREAMS_DESCRIPTION = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsDescription',
  {
    defaultMessage:
      'Choose existing data streams. Saving creates a query stream that reads from those sources.',
  }
);

export const SELECT_DATA_STREAMS_LOGS_AND_METRICS_TAB = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsLogsAndMetricsTab',
  {
    defaultMessage: 'Logs & Metrics',
  }
);

export const SELECT_DATA_STREAMS_OTHER_TAB = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsOtherTab',
  {
    defaultMessage: 'Other',
  }
);

export const SELECT_DATA_STREAMS_SAVE_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsSaveButtonLabel',
  {
    defaultMessage: 'Save',
  }
);

export const SELECT_DATA_STREAMS_SELECTION_REQUIRED = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsSelectionRequiredErrorMessage',
  {
    defaultMessage: 'Select at least one data stream',
  }
);

export const SELECT_DATA_STREAMS_EMPTY_MESSAGE = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsEmptyMessage',
  {
    defaultMessage: 'No data streams found.',
  }
);

export const SELECT_DATA_STREAMS_SEARCH_PLACEHOLDER = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsSearchPlaceholder',
  {
    defaultMessage: 'Search data streams',
  }
);

export const SELECT_DATA_STREAMS_NAME_COLUMN = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsNameColumnHeader',
  {
    defaultMessage: 'Data stream',
  }
);

export const SELECT_DATA_STREAMS_TYPE_COLUMN = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsTypeColumnHeader',
  {
    defaultMessage: 'Type',
  }
);

export const SELECT_DATA_STREAMS_TYPE_LOGS = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsTypeLogsLabel',
  {
    defaultMessage: 'Logs',
  }
);

export const SELECT_DATA_STREAMS_TYPE_METRICS = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsTypeMetricsLabel',
  {
    defaultMessage: 'Metrics',
  }
);

export const SELECT_DATA_STREAMS_TYPE_OTHER = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsTypeOtherLabel',
  {
    defaultMessage: 'Other',
  }
);

export const SELECT_DATA_STREAMS_TABLE_CAPTION = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsTableCaptionAriaLabel',
  {
    defaultMessage: 'Existing data streams',
  }
);

export const SELECT_DATA_STREAMS_LOAD_ERROR_TITLE = i18n.translate(
  'xpack.significantEventsApp.streamsView.selectDataStreamsLoadErrorTitle',
  {
    defaultMessage: 'Could not load data streams',
  }
);

export const getSelectDataStreamsSelectedCountLabel = (count: number): string =>
  i18n.translate('xpack.significantEventsApp.streamsView.selectDataStreamsSelectedCountLabel', {
    defaultMessage: '{count, plural, one {# data stream selected} other {# data streams selected}}',
    values: { count },
  });
