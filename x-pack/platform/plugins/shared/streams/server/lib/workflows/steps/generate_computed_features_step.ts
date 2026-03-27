/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import { generateAllComputedFeatures } from '@kbn/streams-ai';
import { generateComputedFeaturesStepCommonDefinition } from '../../../../common/workflows/steps/generate_computed_features';
import type { GenerateComputedFeaturesStepInput } from '../../../../common/workflows/steps/generate_computed_features';
import type { GetScopedClients } from '../../../routes/types';
import { createStepLoggerAdapter } from './step_logger_adapter';

export const getGenerateComputedFeaturesStepDefinition = (getScopedClients: GetScopedClients) =>
  createServerStepDefinition({
    ...generateComputedFeaturesStepCommonDefinition,
    handler: async (context: StepHandlerContext) => {
      try {
        const input = context.input as GenerateComputedFeaturesStepInput;
        const logger = createStepLoggerAdapter(context.logger);
        const request = context.contextManager.getFakeRequest();
        const { scopedClusterClient, streamsClient } = await getScopedClients({ request });

        const streamName = input['stream-name'];
        const stream = await streamsClient.getStream(streamName);

        const computedFeatures = await generateAllComputedFeatures({
          stream,
          start: input.start,
          end: input.end,
          esClient: scopedClusterClient.asCurrentUser,
          logger,
        });

        return {
          output: {
            features: computedFeatures,
          },
        };
      } catch (error) {
        return { error: error instanceof Error ? error : new Error(String(error)) };
      }
    },
  });
