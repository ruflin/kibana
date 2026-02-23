/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import {
  insightImpactLevelSchema,
  insightSourceSchema,
  insightStatusSchema,
  insightCategorySchema,
} from '@kbn/streams-schema/src/insights';
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
  INSIGHT_RELATED_FEATURE_UUIDS,
  INSIGHT_RELATED_QUERY_IDS,
  INSIGHT_TAGS,
  INSIGHT_TIME_RANGE,
  INSIGHT_CREATED_AT,
  INSIGHT_UPDATED_AT,
  INSIGHT_EXPIRES_AT,
  INSIGHT_PARENT_INSIGHT_ID,
  INSIGHT_RELATED_INSIGHT_IDS,
  INSIGHT_FEEDBACK,
  INSIGHT_TITLE_SEMANTIC,
  INSIGHT_DESCRIPTION_SEMANTIC,
  INSIGHT_RECOMMENDATIONS_SEMANTIC,
} from './fields';

export const storedInsightSchema = z.object({
  [INSIGHT_ID]: z.string(),
  [INSIGHT_UUID]: z.string(),
  [STREAM_NAME]: z.string(),
  [INSIGHT_TITLE]: z.string(),
  [INSIGHT_DESCRIPTION]: z.string(),
  [INSIGHT_IMPACT]: insightImpactLevelSchema,
  [INSIGHT_CATEGORY]: insightCategorySchema,
  [INSIGHT_SOURCE]: insightSourceSchema,
  [INSIGHT_STATUS]: insightStatusSchema,
  [INSIGHT_CONFIDENCE]: z.number(),
  [INSIGHT_EVIDENCE]: z.array(z.record(z.string(), z.any())),
  [INSIGHT_RECOMMENDATIONS]: z.array(z.string()),
  [INSIGHT_RELATED_FEATURES]: z.array(z.string()).optional(),
  [INSIGHT_RELATED_QUERIES]: z.array(z.string()).optional(),
  [INSIGHT_RELATED_FEATURE_UUIDS]: z.array(z.string()).optional(),
  [INSIGHT_RELATED_QUERY_IDS]: z.array(z.string()).optional(),
  [INSIGHT_PARENT_INSIGHT_ID]: z.string().optional(),
  [INSIGHT_RELATED_INSIGHT_IDS]: z.array(z.string()).optional(),
  [INSIGHT_FEEDBACK]: z.array(z.record(z.string(), z.any())).optional(),
  [INSIGHT_TAGS]: z.array(z.string()).optional(),
  [INSIGHT_TIME_RANGE]: z.object({ start: z.string(), end: z.string() }).optional(),
  [INSIGHT_CREATED_AT]: z.string(),
  [INSIGHT_UPDATED_AT]: z.string(),
  [INSIGHT_EXPIRES_AT]: z.string().optional(),
  [INSIGHT_TITLE_SEMANTIC]: z.string().optional(),
  [INSIGHT_DESCRIPTION_SEMANTIC]: z.string().optional(),
  [INSIGHT_RECOMMENDATIONS_SEMANTIC]: z.string().optional(),
});

export type StoredInsight = z.infer<typeof storedInsightSchema>;
