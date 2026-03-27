/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import type { BaseFeature, Feature, IgnoredFeature } from '@kbn/streams-schema';
import { isComputedFeature, isDuplicateFeature } from '@kbn/streams-schema';
import { v4 as uuid, v5 as uuidv5 } from 'uuid';
import { reconcileAndPersistFeaturesStepCommonDefinition } from '../../../../common/workflows/steps/reconcile_and_persist_features';
import type { ReconcileAndPersistFeaturesStepInput } from '../../../../common/workflows/steps/reconcile_and_persist_features';
import type { GetScopedClients } from '../../../routes/types';
import { MAX_FEATURE_AGE_MS } from '../../streams/feature/feature_client';

export const getReconcileAndPersistFeaturesStepDefinition = (getScopedClients: GetScopedClients) =>
  createServerStepDefinition({
    ...reconcileAndPersistFeaturesStepCommonDefinition,
    handler: async (context: StepHandlerContext) => {
      try {
        const input = context.input as ReconcileAndPersistFeaturesStepInput;
        const request = context.contextManager.getFakeRequest();
        const { featureClient } = await getScopedClients({ request });

        const streamName = input['stream-name'];
        const inferredBaseFeatures = input['inferred-features'] as BaseFeature[];
        const computedFeatures = input['computed-features'] as BaseFeature[];
        const ignoredFeatures = input['ignored-features'] as IgnoredFeature[];

        const { hits: existingFeatures } = await featureClient.getFeatures(streamName);
        const { hits: excludedFeatures } = await featureClient.getExcludedFeatures(streamName);

        for (const ignored of ignoredFeatures) {
          context.logger.debug(
            `LLM ignored feature "${ignored.feature_id}" (matched excluded "${ignored.excluded_feature_id}"): ${ignored.reason}`
          );
        }

        let codeIgnoredCount = 0;
        const nonExcludedInferredFeatures = inferredBaseFeatures.filter((feature) => {
          const matchingExcluded = excludedFeatures.find((excluded) =>
            isDuplicateFeature(feature, excluded)
          );
          if (matchingExcluded) {
            codeIgnoredCount++;
            context.logger.debug(
              `Dropping inferred feature [${feature.id}] because it matches excluded feature [${matchingExcluded.id}]`
            );
            return false;
          }
          return true;
        });

        const identifiedFeatures: BaseFeature[] = [
          ...nonExcludedInferredFeatures,
          ...computedFeatures,
        ];

        let newFeaturesCount = nonExcludedInferredFeatures.length;
        const now = Date.now();
        const features: Feature[] = identifiedFeatures.map((feature) => {
          const existing = featureClient.findDuplicateFeature({
            existingFeatures,
            feature,
          });
          const isComputed = isComputedFeature(feature);
          if (existing && !isComputed) {
            newFeaturesCount--;
          }
          return {
            ...feature,
            status: 'active' as const,
            last_seen: new Date(now).toISOString(),
            expires_at: new Date(now + MAX_FEATURE_AGE_MS).toISOString(),
            uuid: isComputed
              ? uuidv5(`${streamName}:${feature.id}`, uuidv5.DNS)
              : existing?.uuid ?? uuid(),
          };
        });

        await featureClient.bulk(
          streamName,
          features.map((feature) => ({ index: { feature } }))
        );

        return {
          output: {
            'features-count': features.length,
            'new-features-count': newFeaturesCount,
          },
        };
      } catch (error) {
        return { error: error instanceof Error ? error : new Error(String(error)) };
      }
    },
  });
