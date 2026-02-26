/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ToolSchema } from '@kbn/inference-common';
import { z } from '@kbn/zod';
import zodToJsonSchema from 'zod-to-json-schema';

export const GET_STREAM_FEATURES_TOOL_NAME = 'get_stream_features';
export const SEARCH_EVENTS_TOOL_NAME = 'search_events';
export const GET_QUERY_DEFINITIONS_TOOL_NAME = 'get_query_definitions';
export const GET_QUERY_RESULTS_TOOL_NAME = 'get_query_results';

const getStreamFeaturesArgsSchema = z.object({
  streamName: z.string().describe('The name of the stream to fetch features for'),
  type: z
    .array(z.string())
    .optional()
    .describe('Filter features by type (e.g. "system", "dataset_analysis", "log_patterns")'),
  limit: z.number().optional().describe('Maximum number of features to return (default: 50)'),
});

export type GetStreamFeaturesArgs = z.infer<typeof getStreamFeaturesArgsSchema>;

export const getStreamFeaturesToolSchema = zodToJsonSchema(getStreamFeaturesArgsSchema, {
  $refStrategy: 'none',
}) as unknown as ToolSchema;

const searchEventsArgsSchema = z.object({
  streamName: z.string().describe('The name of the stream to search events in'),
  kql: z
    .string()
    .optional()
    .describe('KQL filter expression to narrow results (e.g. "log.level: error")'),
  timeRangeMinutes: z.number().optional().describe('How many minutes back to search (default: 15)'),
  size: z.number().optional().describe('Maximum number of events to return (default: 10, max: 50)'),
});

export type SearchEventsArgs = z.infer<typeof searchEventsArgsSchema>;

export const searchEventsToolSchema = zodToJsonSchema(searchEventsArgsSchema, {
  $refStrategy: 'none',
}) as unknown as ToolSchema;

const getQueryDefinitionsArgsSchema = z.object({
  streamName: z.string().describe('The name of the stream to get query definitions for'),
});

export type GetQueryDefinitionsArgs = z.infer<typeof getQueryDefinitionsArgsSchema>;

export const getQueryDefinitionsToolSchema = zodToJsonSchema(getQueryDefinitionsArgsSchema, {
  $refStrategy: 'none',
}) as unknown as ToolSchema;

const getQueryResultsArgsSchema = z.object({
  streamName: z.string().describe('The name of the stream to get recent query results for'),
  timeRangeMinutes: z
    .number()
    .optional()
    .describe('How many minutes back to look for alerts (default: 15)'),
  maxSampleEvents: z.number().optional().describe('Maximum sample events per query (default: 5)'),
});

export type GetQueryResultsArgs = z.infer<typeof getQueryResultsArgsSchema>;

export const getQueryResultsToolSchema = zodToJsonSchema(getQueryResultsArgsSchema, {
  $refStrategy: 'none',
}) as unknown as ToolSchema;
