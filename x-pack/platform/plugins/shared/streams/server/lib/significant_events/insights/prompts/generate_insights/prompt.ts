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
import { insightsSchema, SUBMIT_INSIGHTS_TOOL_NAME } from '../../schema';
import {
  GET_STREAM_FEATURES_TOOL_NAME,
  SEARCH_EVENTS_TOOL_NAME,
  GET_QUERY_DEFINITIONS_TOOL_NAME,
  getStreamFeaturesToolSchema,
  searchEventsToolSchema,
  getQueryDefinitionsToolSchema,
} from '../../tools/tool_schemas';

export const GenerateInsightsPrompt = createPrompt({
  name: 'generate_insights',
  input: z.object({
    discoveries: z.string(),
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
          'Fetch features (systems, components, log patterns) for a stream. Use this to understand the monitoring context when correlating discoveries.',
        schema: getStreamFeaturesToolSchema,
      },
      [GET_QUERY_DEFINITIONS_TOOL_NAME]: {
        description:
          'Get query definitions for a stream. Use this to understand what monitoring rules exist and how they relate to the discoveries.',
        schema: getQueryDefinitionsToolSchema,
      },
      [SEARCH_EVENTS_TOOL_NAME]: {
        description:
          'Search for raw events in a data stream. Use this to investigate discoveries more deeply or look for correlating events.',
        schema: searchEventsToolSchema,
      },
      [SUBMIT_INSIGHTS_TOOL_NAME]: {
        description:
          'Submit the analytical insights derived from the discoveries. Call this when you have completed your analysis.',
        schema: insightsSchema,
      },
    },
  })
  .get();
