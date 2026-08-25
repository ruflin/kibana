/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { i18n } from '@kbn/i18n';

export const SIGNIFICANT_EVENTS_COLUMN_HEADER = i18n.translate(
  'xpack.significantEventsApp.streamsTree.significantEventsColumnName',
  {
    defaultMessage: 'Events',
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

export const ONBOARDING_FAILURE_TITLE = i18n.translate(
  'xpack.significantEventsApp.streamsView.onboardingErrorTitle',
  {
    defaultMessage: 'Could not onboard stream',
  }
);
