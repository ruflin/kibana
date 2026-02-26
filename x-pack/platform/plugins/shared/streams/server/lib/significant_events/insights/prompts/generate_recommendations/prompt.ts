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
import { recommendationsSchema, SUBMIT_RECOMMENDATIONS_TOOL_NAME } from '../../schema';

export const GenerateRecommendationsPrompt = createPrompt({
  name: 'generate_recommendations',
  input: z.object({
    insights: z.string(),
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
      [SUBMIT_RECOMMENDATIONS_TOOL_NAME]: {
        description: 'Submit the actionable recommendations based on the insights',
        schema: recommendationsSchema,
      },
    },
    toolChoice: { function: SUBMIT_RECOMMENDATIONS_TOOL_NAME },
  })
  .get();
