/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { TaskDefinitionRegistry } from '@kbn/task-manager-plugin/server';
import type { DiscoveryPipelineResult } from '@kbn/streams-schema';
import { isInferenceProviderError } from '@kbn/inference-common';
import { getDeleteTaskRunResult } from '@kbn/task-manager-plugin/server/task';
import type { TaskContext } from '.';
import { cancellableTask } from '../cancellable_task';
import type { TaskParams } from '../types';
import { generateDiscoveries } from '../../significant_events/discovery/generate_discoveries';
import { getErrorMessage } from '../../streams/errors/parse_error';
import { formatInferenceProviderError } from '../../../routes/utils/create_connector_sse_error';

export interface DiscoveryTaskParams {
  connectorId: string;
  streamNames?: string[];
  enableMetricsTraces?: boolean;
}

export const STREAMS_DISCOVERY_TASK_TYPE = 'streams_discovery';

export function createStreamsDiscoveryTask(taskContext: TaskContext) {
  return {
    [STREAMS_DISCOVERY_TASK_TYPE]: {
      createTaskRunner: (runContext) => {
        return {
          run: cancellableTask(
            async () => {
              if (!runContext.fakeRequest) {
                throw new Error('Request is required to run this task');
              }

              const { connectorId, streamNames, enableMetricsTraces, _task } = runContext.taskInstance
                .params as TaskParams<DiscoveryTaskParams>;

              const {
                taskClient,
                scopedClusterClient,
                streamsClient,
                inferenceClient,
                queryClient,
                discoveryClient,
                featureClient,
              } = await taskContext.getScopedClients({
                request: runContext.fakeRequest,
              });

              const boundInferenceClient = inferenceClient.bindTo({ connectorId });

              try {
                const result = await generateDiscoveries({
                  streamsClient,
                  queryClient,
                  esClient: scopedClusterClient.asCurrentUser,
                  scopedClusterClient,
                  inferenceClient: boundInferenceClient,
                  signal: runContext.abortController.signal,
                  logger: taskContext.logger.get('discovery'),
                  streamNames,
                  discoveryClient,
                  featureClient,
                  connectorId,
                  enableMetricsTraces,
                });

                taskContext.telemetry.trackDiscoveriesGenerated({
                  input_tokens_used: result.tokensUsed?.prompt ?? 0,
                  output_tokens_used: result.tokensUsed?.completion ?? 0,
                  cached_tokens_used: result.tokensUsed?.cached ?? 0,
                });

                await taskClient.complete<DiscoveryTaskParams, DiscoveryPipelineResult>(
                  _task,
                  { connectorId, streamNames },
                  result
                );
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

                await taskClient.fail<DiscoveryTaskParams>(
                  _task,
                  { connectorId, streamNames },
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
