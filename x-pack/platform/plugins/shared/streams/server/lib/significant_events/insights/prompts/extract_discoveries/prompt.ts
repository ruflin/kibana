/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createPrompt } from '@kbn/inference-common';
import { z } from '@kbn/zod';
import systemPromptTemplate from './system_prompt.text';
import userPromptTemplate from './user_prompt.text';
import { discoveriesSchema, SUBMIT_DISCOVERIES_TOOL_NAME } from '../../schema';
import {
  GET_STREAM_FEATURES_TOOL_NAME,
  SEARCH_EVENTS_TOOL_NAME,
  GET_QUERY_DEFINITIONS_TOOL_NAME,
  GET_QUERY_RESULTS_TOOL_NAME,
  getStreamFeaturesToolSchema,
  searchEventsToolSchema,
  getQueryDefinitionsToolSchema,
  getQueryResultsToolSchema,
} from '../../tools/tool_schemas';

export const ExtractDiscoveriesPrompt = createPrompt({
  name: 'extract_discoveries',
  input: z.object({
    streamNames: z.string(),
  }),
})
  .version({
    system: {
      mustache: {
        template: systemPromptTemplate,
      },
    },
    template: {
      mustache: {
        template: userPromptTemplate,
      },
    },
    tools: {
      [GET_STREAM_FEATURES_TOOL_NAME]: {
        description:
          'Fetch features (systems, components, log patterns) identified for a stream. Returns feature type, description, confidence, and tags.',
        schema: getStreamFeaturesToolSchema,
      },
      [GET_QUERY_DEFINITIONS_TOOL_NAME]: {
        description:
          'Get all significant event query definitions for a stream. Returns query titles, KQL filters, and associated feature names. Use this to understand what is being monitored.',
        schema: getQueryDefinitionsToolSchema,
      },
      [GET_QUERY_RESULTS_TOOL_NAME]: {
        description:
          'Get recent query results (alerts) for a stream, including event counts and sample events. Use this to see which queries have fired and what they detected.',
        schema: getQueryResultsToolSchema,
      },
      [SEARCH_EVENTS_TOOL_NAME]: {
        description:
          'Search for raw events in a data stream with optional KQL filter and time range. Use this to dig deeper into specific patterns or investigate anomalies.',
        schema: searchEventsToolSchema,
      },
      [SUBMIT_DISCOVERIES_TOOL_NAME]: {
        description:
          'Submit the extracted discoveries. Call this when you have completed your investigation.',
        schema: discoveriesSchema,
      },
    },
  })
  .get();
