/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import type { CommonStepDefinition } from '@kbn/workflows-extensions/common';

export const GenerateComputedFeaturesStepTypeId = 'streams.generateComputedFeatures';

export const InputSchema = z.object({
  'stream-name': z.string(),
  start: z.number(),
  end: z.number(),
});

export const OutputSchema = z.object({
  features: z.array(z.any()),
});

export type GenerateComputedFeaturesStepInput = z.infer<typeof InputSchema>;
export type GenerateComputedFeaturesStepOutput = z.infer<typeof OutputSchema>;

export const generateComputedFeaturesStepCommonDefinition: CommonStepDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  id: GenerateComputedFeaturesStepTypeId,
  category: StepCategory.Kibana,
  label: 'Generate Computed Features',
  description:
    'Generate computed features (dataset description, error patterns, log patterns) via ES queries.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
};
