/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { MAX_ID_LENGTH, MAX_TEXT_LENGTH } from './significant_events/constants';

export const MAX_SIGNIFICANT_EVENTS_DATA_VIEWS = 100;

/**
 * A configured ES|QL view used as a Significant Events / Nightshift data source.
 * `owned` is true only for views created from the Views tab.
 */
export const significantEventsDataViewSchema = z.object({
  name: z.string().min(1).max(MAX_ID_LENGTH),
  enabled: z.boolean(),
  owned: z.boolean(),
  query: z.string().max(MAX_TEXT_LENGTH).optional(),
});

export type SignificantEventsDataView = z.infer<typeof significantEventsDataViewSchema>;

export const significantEventsDataViewsStateSchema = z.object({
  views: z.array(significantEventsDataViewSchema).max(MAX_SIGNIFICANT_EVENTS_DATA_VIEWS),
});

export type SignificantEventsDataViewsState = z.infer<typeof significantEventsDataViewsStateSchema>;

/** Prefer `view_name` when present; stored documents still use `stream_name`. */
export const getViewName = (entity: {
  view_name?: string;
  stream_name?: string;
}): string | undefined => entity.view_name ?? entity.stream_name;

/** Prefer `view_names` when present; stored documents still use `stream_names`. */
export const getViewNames = (entity: {
  view_names?: string[];
  stream_names?: string[];
}): string[] => entity.view_names ?? entity.stream_names ?? [];
