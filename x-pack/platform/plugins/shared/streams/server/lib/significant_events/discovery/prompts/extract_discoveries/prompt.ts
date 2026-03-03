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

export const ExtractDiscoveriesPrompt = createPrompt({
  name: 'extract_discoveries',
  input: z.object({
    streamName: z.string(),
    queries: z.string(),
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
      [SUBMIT_DISCOVERIES_TOOL_NAME]: {
        description: 'Submit the identified discoveries for this stream',
        schema: discoveriesSchema,
      },
    },
    toolChoice: { function: SUBMIT_DISCOVERIES_TOOL_NAME },
  })
  .get();
