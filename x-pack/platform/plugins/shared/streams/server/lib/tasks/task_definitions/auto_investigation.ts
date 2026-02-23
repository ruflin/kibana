/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { TaskDefinitionRegistry } from '@kbn/task-manager-plugin/server';
import { isInferenceProviderError } from '@kbn/inference-common';
import type { InsightsResult } from '@kbn/streams-schema';
import { getDeleteTaskRunResult } from '@kbn/task-manager-plugin/server/task';
import type { TaskContext } from '.';
import { cancellableTask } from '../cancellable_task';
import type { TaskParams } from '../types';
import { generateInsights } from '../../significant_events/insights/generate_insights';
import { getErrorMessage } from '../../streams/errors/parse_error';
import { formatInferenceProviderError } from '../../../routes/utils/create_connector_sse_error';

export interface AutoInvestigationTaskParams {
  connectorId: string;
  streamName: string;
  alertId?: string;
  triggerReason?: string;
}

export const STREAMS_AUTO_INVESTIGATION_TASK_TYPE = 'streams_auto_investigation';

const DEBOUNCE_WINDOW_MS = 5 * 60 * 1000;

export function createStreamsAutoInvestigationTask(taskContext: TaskContext) {
  return {
    [STREAMS_AUTO_INVESTIGATION_TASK_TYPE]: {
      createTaskRunner: (runContext) => {
        return {
          run: cancellableTask(
            async () => {
              if (!runContext.fakeRequest) {
                throw new Error('Request is required to run this task');
              }

              const { connectorId, streamName, alertId, triggerReason, _task } = runContext
                .taskInstance.params as TaskParams<AutoInvestigationTaskParams>;

              const {
                taskClient,
                scopedClusterClient,
                streamsClient,
                inferenceClient,
                queryClient,
                insightClient,
                featureClient,
              } = await taskContext.getScopedClients({
                request: runContext.fakeRequest,
              });

              if (insightClient) {
                const { hits: recentInsights } = await insightClient.getInsights(streamName, {
                  limit: 5,
                  status: 'new',
                });

                const recentAutoInsight = recentInsights.find(
                  (i) =>
                    i.source === 'task' &&
                    new Date(i.created_at).getTime() > Date.now() - DEBOUNCE_WINDOW_MS
                );

                if (recentAutoInsight) {
                  taskContext.logger.info(
                    `Skipping auto-investigation for ${streamName}: recent investigation exists (${recentAutoInsight.uuid})`
                  );
                  await taskClient.complete<AutoInvestigationTaskParams, InsightsResult>(
                    _task,
                    { connectorId, streamName, alertId, triggerReason },
                    {
                      insights: [],
                      tokensUsed: { prompt: 0, completion: 0, total: 0 },
                    }
                  );
                  return getDeleteTaskRunResult();
                }
              }

              const boundInferenceClient = inferenceClient.bindTo({ connectorId });

              try {
                const result = await generateInsights({
                  streamsClient,
                  queryClient,
                  esClient: scopedClusterClient.asCurrentUser,
                  inferenceClient: boundInferenceClient,
                  insightClient,
                  featureClient,
                  signal: runContext.abortController.signal,
                  logger: taskContext.logger.get('auto_investigation'),
                  streamNames: [streamName],
                });

                taskContext.telemetry.trackInsightsGenerated({
                  input_tokens_used: result.tokensUsed?.prompt ?? 0,
                  output_tokens_used: result.tokensUsed?.completion ?? 0,
                  cached_tokens_used: result.tokensUsed?.cached ?? 0,
                });

                await taskClient.complete<AutoInvestigationTaskParams, InsightsResult>(
                  _task,
                  { connectorId, streamName, alertId, triggerReason },
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
                  `Auto-investigation task ${runContext.taskInstance.id} failed: ${errorMessage}`
                );

                await taskClient.fail<AutoInvestigationTaskParams>(
                  _task,
                  { connectorId, streamName, alertId, triggerReason },
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
