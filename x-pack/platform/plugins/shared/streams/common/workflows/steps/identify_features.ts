/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import type { CommonStepDefinition } from '@kbn/workflows-extensions/common';

export const IdentifyFeaturesStepTypeId = 'streams.identifyFeatures';

export const InputSchema = z.object({
  'stream-name': z.string(),
  documents: z.array(z.any()),
});

export const ConfigSchema = z
  .object({
    'connector-id': z.string().optional(),
  })
  .partial();

export const OutputSchema = z.object({
  features: z.array(z.any()),
  'ignored-features': z.array(z.any()),
  'tokens-used': z.object({
    prompt: z.number(),
    completion: z.number(),
    total: z.number(),
  }),
});

export type IdentifyFeaturesStepInput = z.infer<typeof InputSchema>;
export type IdentifyFeaturesStepOutput = z.infer<typeof OutputSchema>;

export const identifyFeaturesStepCommonDefinition: CommonStepDefinition<
  typeof InputSchema,
  typeof OutputSchema,
  typeof ConfigSchema
> = {
  id: IdentifyFeaturesStepTypeId,
  category: StepCategory.Ai,
  label: 'Identify Features',
  description:
    'Run LLM-based feature identification on sample documents to extract knowledge indicators.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  configSchema: ConfigSchema,
};
