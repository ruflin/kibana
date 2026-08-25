/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { i18n } from '@kbn/i18n';

export const VIEWS_TAB_TITLE = i18n.translate('xpack.significantEventsApp.viewsTab', {
  defaultMessage: 'Views',
});

export const VIEWS_COUNT_LABEL = (count: number) =>
  i18n.translate('xpack.significantEventsApp.viewsView.viewsCountLabel', {
    defaultMessage: '{count, plural, one {# view} other {# views}}',
    values: { count },
  });

export const VIEWS_SEARCH_PLACEHOLDER = i18n.translate(
  'xpack.significantEventsApp.viewsView.searchPlaceholder',
  { defaultMessage: 'Search views by name' }
);

export const ADD_EXISTING_VIEW_BUTTON = i18n.translate(
  'xpack.significantEventsApp.viewsView.addExistingButton',
  { defaultMessage: 'Add existing view' }
);

export const CREATE_VIEW_BUTTON = i18n.translate(
  'xpack.significantEventsApp.viewsView.createViewButton',
  { defaultMessage: 'Create view' }
);

export const ENABLED_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.viewsView.enabledColumn',
  { defaultMessage: 'Used' }
);

export const NAME_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.viewsView.nameColumn',
  { defaultMessage: 'View' }
);

export const OWNED_BADGE = i18n.translate('xpack.significantEventsApp.viewsView.ownedBadge', {
  defaultMessage: 'Created here',
});

export const NO_VIEWS_MESSAGE = i18n.translate(
  'xpack.significantEventsApp.viewsView.noViewsMessage',
  {
    defaultMessage: 'No ES|QL views configured. Add an existing view or create one from a query.',
  }
);

export const ADD_EXISTING_FLYOUT_TITLE = i18n.translate(
  'xpack.significantEventsApp.viewsView.addExistingFlyoutTitle',
  { defaultMessage: 'Add existing ES|QL view' }
);

export const CREATE_FLYOUT_TITLE = i18n.translate(
  'xpack.significantEventsApp.viewsView.createFlyoutTitle',
  { defaultMessage: 'Create ES|QL view' }
);

export const VIEW_NAME_LABEL = i18n.translate(
  'xpack.significantEventsApp.viewsView.viewNameLabel',
  {
    defaultMessage: 'Name',
  }
);

export const VIEW_QUERY_LABEL = i18n.translate(
  'xpack.significantEventsApp.viewsView.viewQueryLabel',
  { defaultMessage: 'ES|QL query' }
);

export const ADD_VIEW_CONFIRM = i18n.translate(
  'xpack.significantEventsApp.viewsView.addViewConfirm',
  { defaultMessage: 'Add view' }
);

export const CREATE_VIEW_CONFIRM = i18n.translate(
  'xpack.significantEventsApp.viewsView.createViewConfirm',
  { defaultMessage: 'Create view' }
);

export const CANCEL_LABEL = i18n.translate('xpack.significantEventsApp.viewsView.cancel', {
  defaultMessage: 'Cancel',
});

export const REMOVE_VIEW_LABEL = i18n.translate('xpack.significantEventsApp.viewsView.removeView', {
  defaultMessage: 'Remove',
});

export const ENABLE_VIEW_LABEL = i18n.translate('xpack.significantEventsApp.viewsView.enableView', {
  defaultMessage: 'Use this view',
});

export const GENERATE_DISABLED_TOOLTIP = i18n.translate(
  'xpack.significantEventsApp.viewsView.generateDisabledTooltip',
  { defaultMessage: 'Enable the view before generating knowledge indicators.' }
);

export const VIEWS_TABLE_CAPTION = i18n.translate(
  'xpack.significantEventsApp.viewsView.tableCaption',
  { defaultMessage: 'Configured ES|QL views' }
);
