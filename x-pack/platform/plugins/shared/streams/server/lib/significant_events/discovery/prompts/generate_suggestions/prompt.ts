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
import { suggestionsSchema, SUBMIT_SUGGESTIONS_TOOL_NAME } from '../../suggestion_schema';

export const GenerateSuggestionsPrompt = createPrompt({
  name: 'generate_suggestions',
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
      [SUBMIT_SUGGESTIONS_TOOL_NAME]: {
        description: 'Submit the generated ES|QL query suggestions',
        schema: suggestionsSchema,
      },
    },
    toolChoice: { function: SUBMIT_SUGGESTIONS_TOOL_NAME },
  })
  .get();
