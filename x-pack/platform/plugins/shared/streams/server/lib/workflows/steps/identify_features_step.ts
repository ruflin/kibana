/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SearchHit } from '@elastic/elasticsearch/lib/api/types';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import { identifyFeatures } from '@kbn/streams-ai';
import type { ExcludedFeatureSummary } from '@kbn/streams-ai';
import { identifyFeaturesStepCommonDefinition } from '../../../../common/workflows/steps/identify_features';
import type { IdentifyFeaturesStepInput } from '../../../../common/workflows/steps/identify_features';
import { resolveConnectorId } from '../../../routes/utils/resolve_connector_id';
import { PromptsConfigService } from '../../saved_objects/significant_events/prompts_config_service';
import type { GetScopedClients } from '../../../routes/types';
import { createStepLoggerAdapter } from './step_logger_adapter';

const MAX_EXCLUDED_FEATURES_FOR_PROMPT = 10;

export const getIdentifyFeaturesStepDefinition = (getScopedClients: GetScopedClients) =>
  createServerStepDefinition({
    ...identifyFeaturesStepCommonDefinition,
    handler: async (context: StepHandlerContext) => {
      try {
        const input = context.input as IdentifyFeaturesStepInput;
        const config = context.config as { 'connector-id'?: string };
        const logger = createStepLoggerAdapter(context.logger);
        const request = context.contextManager.getFakeRequest();
        const { inferenceClient, featureClient, soClient, modelSettingsClient, uiSettingsClient } =
          await getScopedClients({ request });

        const streamName = input['stream-name'];
        const settings = await modelSettingsClient.getSettings();
        const connectorId = await resolveConnectorId({
          connectorId: config['connector-id'] ?? settings.connectorIdKnowledgeIndicatorExtraction,
          uiSettingsClient,
          logger,
        });

        const { hits: excludedFeatures } = await featureClient.getExcludedFeatures(streamName);
        const { featurePromptOverride } = await new PromptsConfigService({
          soClient,
          logger,
        }).getPrompt();

        const excludedSummaries: ExcludedFeatureSummary[] = excludedFeatures
          .slice(0, MAX_EXCLUDED_FEATURES_FOR_PROMPT)
          .map(({ id, type, subtype, title, description, properties }) => ({
            id,
            type,
            subtype,
            title,
            description,
            properties,
          }));

        const boundInferenceClient = inferenceClient.bindTo({ connectorId });

        const result = await identifyFeatures({
          streamName,
          sampleDocuments: input.documents as Array<SearchHit<Record<string, unknown>>>,
          excludedFeatures: excludedSummaries,
          inferenceClient: boundInferenceClient,
          logger,
          signal: context.abortSignal,
          systemPrompt: featurePromptOverride,
        });

        return {
          output: {
            features: result.features,
            'ignored-features': result.ignoredFeatures,
            'tokens-used': {
              prompt: result.tokensUsed.prompt,
              completion: result.tokensUsed.completion,
              total: result.tokensUsed.total,
            },
          },
        };
      } catch (error) {
        return { error: error instanceof Error ? error : new Error(String(error)) };
      }
    },
  });
