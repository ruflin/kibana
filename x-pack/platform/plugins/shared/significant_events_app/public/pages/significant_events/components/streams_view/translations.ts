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

export const SIGNIFICANT_EVENTS_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.streamsTree.significantEventsColumnName',
  {
    defaultMessage: 'Events',
  }
);

export const SIGNIFICANT_EVENTS_COLUMN_TOOLTIP = i18n.translate(
  'xpack.significantEventsApp.streamsTree.significantEventsColumnTooltip',
  {
    defaultMessage: 'Number of results produced by created rules.',
  }
);

export const QUERIES_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.streamsTree.queriesColumnName',
  {
    defaultMessage: 'KI Queries',
  }
);

export const KNOWLEDGE_INDICATORS_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.streamsTree.knowledgeIndicatorsColumnName',
  {
    defaultMessage: 'KI Features',
  }
);

export const ONBOARDING_STATUS_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.streamsTree.onboardingStatusColumnName',
  {
    defaultMessage: 'Status',
  }
);

export const ACTIONS_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.streamsTree.actionsColumnName',
  {
    defaultMessage: 'Actions',
  }
);

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

export const RUN_STREAM_ONBOARDING_BUTTON_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsTree.runStreamOnboardingButtonEmptyLabel',
  {
    defaultMessage: 'Onboard stream',
  }
);

/** Onboard-stream tooltip, extended with the cross-project generation disclosure. */
export const RUN_STREAM_ONBOARDING_CROSS_PROJECT_TOOLTIP = i18n.translate(
  'xpack.significantEventsApp.streamsTree.runStreamOnboardingCrossProjectTooltip',
  {
    defaultMessage:
      'Onboard stream. Analyzes data from all projects linked through cross-project search, regardless of the project scope configured for this space.',
  }
);

export const STOP_STREAM_ONBOARDING_BUTTON_LABEL = i18n.translate(
  'xpack.significantEventsApp.streamsTree.stopStreamOnboardingButtonEmptyLabel',
  {
    defaultMessage: 'Stop stream onboarding',
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
