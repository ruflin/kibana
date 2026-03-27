/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import type { CommonStepDefinition } from '@kbn/workflows-extensions/common';

export const FetchSampleDocumentsStepTypeId = 'streams.fetchSampleDocuments';

export const InputSchema = z.object({
  'stream-name': z.string(),
  start: z.number(),
  end: z.number(),
  'sample-size': z.number().optional().default(20),
});

export const OutputSchema = z.object({
  documents: z.array(z.any()),
  'total-filters': z.number(),
  'filters-capped': z.boolean(),
  'has-filtered-documents': z.boolean(),
});

export type FetchSampleDocumentsStepInput = z.infer<typeof InputSchema>;
export type FetchSampleDocumentsStepOutput = z.infer<typeof OutputSchema>;

export const fetchSampleDocumentsStepCommonDefinition: CommonStepDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  id: FetchSampleDocumentsStepTypeId,
  category: StepCategory.Kibana,
  label: 'Fetch Sample Documents',
  description:
    'Fetch sample documents from a stream index, excluding documents matching known features.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
};
