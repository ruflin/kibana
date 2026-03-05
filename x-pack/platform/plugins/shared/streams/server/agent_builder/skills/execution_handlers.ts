/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest } from '@kbn/core/server';
import type { Logger } from '@kbn/logging';
import { OnboardingStep } from '@kbn/streams-schema';
import type { GetScopedClients } from '../../routes/types';
import { STREAMS_DISCOVERY_PIPELINE_TASK_TYPE } from '../../lib/tasks/task_definitions/insights_discovery';
import {
  getOnboardingTaskId,
  STREAMS_ONBOARDING_TASK_TYPE,
} from '../../lib/tasks/task_definitions/onboarding';
import { STREAMS_SUGGESTION_GENERATION_TASK_TYPE } from '../../lib/tasks/task_definitions/suggestion_generation';
import { handleTaskAction } from '../../routes/utils/task_helpers';
import { resolveConnectorId } from '../../routes/utils/resolve_connector_id';
import type { SkillExecutionHandler } from './skill_execution';

export interface SkillExecutionDeps {
  getScopedClients: GetScopedClients;
  logger: Logger;
}

export const createSkillExecutionHandlers = (
  deps: SkillExecutionDeps
): Record<string, SkillExecutionHandler> => ({
  'streams.extract_stream_features': async (input, context) => {
    return scheduleOnboardingForStreams(deps, context.request, input, [
      OnboardingStep.FeaturesIdentification,
    ]);
  },

  'streams.generate_sig_events_queries': async (input, context) => {
    return scheduleOnboardingForStreams(deps, context.request, input, [
      OnboardingStep.QueriesGeneration,
    ]);
  },

  'streams.generate_discoveries': async (input, context) => {
    const streamNames = (input.params.streamNames as string[] | undefined) ?? [];

    const { taskClient, uiSettingsClient } = await deps.getScopedClients({
      request: context.request,
    });

    const connectorId = await resolveConnectorId({
      connectorId: input.connectorId,
      uiSettingsClient,
      logger: deps.logger,
    });

    const result = await handleTaskAction({
      taskClient,
      taskId: STREAMS_DISCOVERY_PIPELINE_TASK_TYPE,
      action: 'schedule',
      scheduleConfig: {
        taskType: STREAMS_DISCOVERY_PIPELINE_TASK_TYPE,
        taskId: STREAMS_DISCOVERY_PIPELINE_TASK_TYPE,
        params: {
          connectorId,
          ...(streamNames.length > 0 ? { streamNames } : {}),
        },
        request: context.request,
      },
    });

    return { status: 'accepted', taskStatus: result.status };
  },

  'streams.generate_suggestions': async (input, context) => {
    const { taskClient, uiSettingsClient } = await deps.getScopedClients({
      request: context.request,
    });

    const connectorId = await resolveConnectorId({
      connectorId: input.connectorId,
      uiSettingsClient,
      logger: deps.logger,
    });

    const result = await handleTaskAction({
      taskClient,
      taskId: STREAMS_SUGGESTION_GENERATION_TASK_TYPE,
      action: 'schedule',
      scheduleConfig: {
        taskType: STREAMS_SUGGESTION_GENERATION_TASK_TYPE,
        taskId: STREAMS_SUGGESTION_GENERATION_TASK_TYPE,
        params: { connectorId },
        request: context.request,
      },
    });

    return { status: 'accepted', taskStatus: result.status };
  },

  'streams.push_entity_definition': async () => {
    return {
      status: 'not_supported',
      message: 'Push entity definition does not support direct execution yet.',
    };
  },

  'streams.investigate_stream': async (input, context) => {
    return scheduleOnboardingForStreams(deps, context.request, input, [
      OnboardingStep.FeaturesIdentification,
      OnboardingStep.QueriesGeneration,
      OnboardingStep.DiscoveryGeneration,
    ]);
  },
});

async function scheduleOnboardingForStreams(
  deps: SkillExecutionDeps,
  request: KibanaRequest,
  input: { params: Record<string, unknown>; connectorId?: string },
  steps: OnboardingStep[]
): Promise<Record<string, unknown>> {
  const streamNames = (input.params.streamNames as string[] | undefined) ?? [];

  if (streamNames.length === 0) {
    return {
      status: 'failed',
      error: 'streamNames is required. Provide at least one stream name.',
    };
  }

  const { taskClient, uiSettingsClient } = await deps.getScopedClients({ request });

  const connectorId = await resolveConnectorId({
    connectorId: input.connectorId,
    uiSettingsClient,
    logger: deps.logger,
  });

  const now = Date.now();
  const from = now - 60 * 60 * 1000;

  const results: Record<string, unknown>[] = [];
  for (const streamName of streamNames) {
    try {
      const taskId = getOnboardingTaskId(streamName, true);
      const result = await handleTaskAction({
        taskClient,
        taskId,
        action: 'schedule',
        scheduleConfig: {
          taskType: STREAMS_ONBOARDING_TASK_TYPE,
          taskId,
          params: {
            connectorId,
            streamName,
            from,
            to: now,
            steps,
            saveQueries: true,
          },
          request,
        },
      });
      results.push({ streamName, status: result.status });
    } catch (e) {
      results.push({
        streamName,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { status: 'accepted', results };
}
