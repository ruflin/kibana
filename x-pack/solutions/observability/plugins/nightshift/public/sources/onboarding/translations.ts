/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { i18n } from '@kbn/i18n';

export const GENERATE_FEATURES_BUTTON_LABEL = i18n.translate(
  'xpack.nightshift.streamsView.generateFeaturesButtonLabel',
  { defaultMessage: 'Generate KI Features' }
);

export const GENERATE_QUERIES_BUTTON_LABEL = i18n.translate(
  'xpack.nightshift.streamsView.generateQueriesButtonLabel',
  { defaultMessage: 'Generate KI Queries' }
);

export const GENERATE_BUTTON_LABEL = i18n.translate(
  'xpack.nightshift.streamsView.generateButtonLabel',
  { defaultMessage: 'Generate' }
);

export const MODEL_SELECTION_PANEL_TITLE = i18n.translate(
  'xpack.nightshift.streamsView.modelSelectionPanelTitle',
  { defaultMessage: 'Model selection' }
);

export const FEATURES_MODEL_ROW_LABEL = i18n.translate(
  'xpack.nightshift.streamsView.featuresModelRowLabel',
  { defaultMessage: 'KI features model' }
);

export const QUERIES_MODEL_ROW_LABEL = i18n.translate(
  'xpack.nightshift.streamsView.queriesModelRowLabel',
  { defaultMessage: 'KI queries model' }
);

export const DEFAULT_MODEL_BADGE_LABEL = i18n.translate(
  'xpack.nightshift.streamsView.defaultModelBadgeLabel',
  { defaultMessage: 'Default' }
);

export const MISSING_DEFAULT_MODEL_LABEL = i18n.translate(
  'xpack.nightshift.streamsView.missingDefaultModelLabel',
  { defaultMessage: 'Default model unavailable' }
);

export const MISSING_SELECTED_MODEL_LABEL = i18n.translate(
  'xpack.nightshift.streamsView.missingSelectedModelLabel',
  { defaultMessage: 'Selected model unavailable' }
);

export const SELECT_MODEL_LABEL = i18n.translate('xpack.nightshift.streamsView.selectModelLabel', {
  defaultMessage: 'Select a model',
});

export const CONFIGURED_DEFAULT_MODEL_CALLOUT_TITLE = i18n.translate(
  'xpack.nightshift.streamsView.configuredDefaultModelCalloutTitle',
  { defaultMessage: 'Configured default model only' }
);

export const CONFIGURED_DEFAULT_MODEL_CALLOUT_DESCRIPTION = i18n.translate(
  'xpack.nightshift.streamsView.configuredDefaultModelCalloutDescription',
  { defaultMessage: 'Generation succeeds only with the configured default model.' }
);
