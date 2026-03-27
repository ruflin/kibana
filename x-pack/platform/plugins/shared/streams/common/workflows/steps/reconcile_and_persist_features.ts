/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import type { CommonStepDefinition } from '@kbn/workflows-extensions/common';

export const ReconcileAndPersistFeaturesStepTypeId = 'streams.reconcileAndPersistFeatures';

export const InputSchema = z.object({
  'stream-name': z.string(),
  'inferred-features': z.array(z.any()),
  'computed-features': z.array(z.any()),
  'ignored-features': z.array(z.any()),
});

export const OutputSchema = z.object({
  'features-count': z.number(),
  'new-features-count': z.number(),
});

export type ReconcileAndPersistFeaturesStepInput = z.infer<typeof InputSchema>;
export type ReconcileAndPersistFeaturesStepOutput = z.infer<typeof OutputSchema>;

export const reconcileAndPersistFeaturesStepCommonDefinition: CommonStepDefinition<
  typeof InputSchema,
  typeof OutputSchema
> = {
  id: ReconcileAndPersistFeaturesStepTypeId,
  category: StepCategory.Kibana,
  label: 'Reconcile and Persist Features',
  description:
    'Deduplicate inferred and computed features against existing features, then bulk-index the results.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
};
