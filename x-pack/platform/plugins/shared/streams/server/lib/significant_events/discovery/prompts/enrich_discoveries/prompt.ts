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

export const EnrichDiscoveriesPrompt = createPrompt({
  name: 'enrich_discoveries',
  input: z.object({
    streamDiscoveries: z.string(),
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
        description: 'Submit system-level discoveries correlating across streams',
        schema: discoveriesSchema,
      },
    },
    toolChoice: { function: SUBMIT_DISCOVERIES_TOOL_NAME },
  })
  .get();
