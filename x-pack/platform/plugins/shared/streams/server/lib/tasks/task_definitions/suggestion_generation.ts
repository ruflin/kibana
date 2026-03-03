/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { TaskDefinitionRegistry } from '@kbn/task-manager-plugin/server';
import { isInferenceProviderError } from '@kbn/inference-common';
import { getDeleteTaskRunResult } from '@kbn/task-manager-plugin/server/task';
import type { TaskContext } from '.';
import { cancellableTask } from '../cancellable_task';
import type { TaskParams } from '../types';
import { generateSuggestionsFromDiscoveries } from '../../significant_events/discovery/generate_suggestions';
import type { GenerateSuggestionsResult } from '../../significant_events/discovery/generate_suggestions';
import { getErrorMessage } from '../../streams/errors/parse_error';
import { formatInferenceProviderError } from '../../../routes/utils/create_connector_sse_error';

export interface SuggestionGenerationTaskParams {
  connectorId: string;
}

export const STREAMS_SUGGESTION_GENERATION_TASK_TYPE = 'streams_suggestion_generation';

export function createStreamsSuggestionGenerationTask(taskContext: TaskContext) {
  return {
    [STREAMS_SUGGESTION_GENERATION_TASK_TYPE]: {
      createTaskRunner: (runContext) => {
        return {
          run: cancellableTask(
            async () => {
              if (!runContext.fakeRequest) {
                throw new Error('Request is required to run this task');
              }

              const { connectorId, _task } = runContext.taskInstance
                .params as TaskParams<SuggestionGenerationTaskParams>;

              const { taskClient, inferenceClient, discoveryClient } =
                await taskContext.getScopedClients({
                  request: runContext.fakeRequest,
                });

              const boundInferenceClient = inferenceClient.bindTo({ connectorId });

              try {
                const result = await generateSuggestionsFromDiscoveries({
                  inferenceClient: boundInferenceClient,
                  signal: runContext.abortController.signal,
                  logger: taskContext.logger.get('suggestion_generation'),
                  discoveryClient,
                });

                await taskClient.complete<
                  SuggestionGenerationTaskParams,
                  GenerateSuggestionsResult
                >(_task, { connectorId }, result);
              } catch (error) {
                const connector = await inferenceClient.getConnectorById(connectorId);

                const errorMessage = isInferenceProviderError(error)
                  ? formatInferenceProviderError(error, connector)
                  : getErrorMessage(error);

                if (
                  errorMessage.includes('ERR_CANCELED') ||
                  errorMessage.includes('Request was aborted')
                ) {
                  return getDeleteTaskRunResult();
                }

                taskContext.logger.error(
                  `Task ${runContext.taskInstance.id} failed: ${errorMessage}`
                );

                await taskClient.fail<SuggestionGenerationTaskParams>(
                  _task,
                  { connectorId },
                  errorMessage
                );
                return getDeleteTaskRunResult();
              }
            },
            runContext,
            taskContext
          ),
        };
      },
    },
  } satisfies TaskDefinitionRegistry;
}
