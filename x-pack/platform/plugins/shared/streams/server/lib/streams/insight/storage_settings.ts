/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IndexStorageSettings } from '@kbn/storage-adapter';
import { types } from '@kbn/storage-adapter';
import {
  STREAM_NAME,
  INSIGHT_UUID,
  INSIGHT_ID,
  INSIGHT_TITLE,
  INSIGHT_DESCRIPTION,
  INSIGHT_IMPACT,
  INSIGHT_CATEGORY,
  INSIGHT_SOURCE,
  INSIGHT_STATUS,
  INSIGHT_CONFIDENCE,
  INSIGHT_EVIDENCE,
  INSIGHT_RECOMMENDATIONS,
  INSIGHT_RELATED_FEATURES,
  INSIGHT_RELATED_QUERIES,
  INSIGHT_TAGS,
  INSIGHT_TIME_RANGE,
  INSIGHT_CREATED_AT,
  INSIGHT_UPDATED_AT,
  INSIGHT_EXPIRES_AT,
  INSIGHT_TITLE_SEMANTIC,
  INSIGHT_DESCRIPTION_SEMANTIC,
  INSIGHT_RECOMMENDATIONS_SEMANTIC,
} from './fields';

export const insightStorageSettings = {
  name: '.kibana_streams_insights',
  schema: {
    properties: {
      [INSIGHT_ID]: types.keyword(),
      [INSIGHT_UUID]: types.keyword(),
      [STREAM_NAME]: types.keyword(),
      [INSIGHT_TITLE]: types.keyword(),
      [INSIGHT_DESCRIPTION]: types.text(),
      [INSIGHT_IMPACT]: types.keyword(),
      [INSIGHT_CATEGORY]: types.keyword(),
      [INSIGHT_SOURCE]: types.keyword(),
      [INSIGHT_STATUS]: types.keyword(),
      [INSIGHT_CONFIDENCE]: types.long(),
      [INSIGHT_EVIDENCE]: types.object({ enabled: false }),
      [INSIGHT_RECOMMENDATIONS]: types.text(),
      [INSIGHT_RELATED_FEATURES]: types.keyword(),
      [INSIGHT_RELATED_QUERIES]: types.keyword(),
      [INSIGHT_TAGS]: types.keyword(),
      [INSIGHT_TIME_RANGE]: types.object({ enabled: false }),
      [INSIGHT_CREATED_AT]: types.date(),
      [INSIGHT_UPDATED_AT]: types.date(),
      [INSIGHT_EXPIRES_AT]: types.date(),
      [INSIGHT_TITLE_SEMANTIC]: types.semantic_text(),
      [INSIGHT_DESCRIPTION_SEMANTIC]: types.semantic_text(),
      [INSIGHT_RECOMMENDATIONS_SEMANTIC]: types.semantic_text(),
    },
  },
} satisfies IndexStorageSettings;

export type InsightStorageSettings = typeof insightStorageSettings;
