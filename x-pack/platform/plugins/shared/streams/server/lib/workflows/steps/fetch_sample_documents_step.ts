/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import type { StepHandlerContext } from '@kbn/workflows-extensions/server';
import { isFeatureWithFilter } from '@kbn/streams-schema';
import { fetchSampleDocumentsStepCommonDefinition } from '../../../../common/workflows/steps/fetch_sample_documents';
import type { FetchSampleDocumentsStepInput } from '../../../../common/workflows/steps/fetch_sample_documents';
import { fetchSampleDocuments } from '../../tasks/task_definitions/features_identification/fetch_sample_documents';
import type { GetScopedClients } from '../../../routes/types';
import { createStepLoggerAdapter } from './step_logger_adapter';

export const getFetchSampleDocumentsStepDefinition = (getScopedClients: GetScopedClients) =>
  createServerStepDefinition({
    ...fetchSampleDocumentsStepCommonDefinition,
    handler: async (context: StepHandlerContext) => {
      try {
        const input = context.input as FetchSampleDocumentsStepInput;
        const logger = createStepLoggerAdapter(context.logger);
        const request = context.contextManager.getFakeRequest();
        const { scopedClusterClient, featureClient, streamsClient } = await getScopedClients({
          request,
        });

        const streamName = input['stream-name'];
        await streamsClient.ensureStream(streamName);

        const { hits: existingFeatures } = await featureClient.getFeatures(streamName);

        const { documents, totalFilters, filtersCapped, hasFilteredDocuments } =
          await fetchSampleDocuments({
            esClient: scopedClusterClient.asCurrentUser,
            index: streamName,
            start: input.start,
            end: input.end,
            features: existingFeatures.filter(isFeatureWithFilter),
            logger,
            size: input['sample-size'],
          });

        return {
          output: {
            documents,
            'total-filters': totalFilters,
            'filters-capped': filtersCapped,
            'has-filtered-documents': hasFilteredDocuments,
          },
        };
      } catch (error) {
        return { error: error instanceof Error ? error : new Error(String(error)) };
      }
    },
  });
