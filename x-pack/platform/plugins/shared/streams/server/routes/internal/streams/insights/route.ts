/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { DiscoveryPipelineResult } from '@kbn/streams-schema';
import { z } from '@kbn/zod';
import type { TaskResult } from '@kbn/streams-schema';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import type { DiscoveryPipelineTaskParams } from '../../../../lib/tasks/task_definitions/insights_discovery';
import { STREAMS_DISCOVERY_PIPELINE_TASK_TYPE } from '../../../../lib/tasks/task_definitions/insights_discovery';
import { taskActionSchema } from '../../../../lib/tasks/task_action_schema';
import { createServerRoute } from '../../../create_server_route';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';
import { resolveConnectorId } from '../../../utils/resolve_connector_id';
import { handleTaskAction } from '../../../utils/task_helpers';

export type DiscoveryTaskResult = TaskResult<DiscoveryPipelineResult>;

const discoveryTaskRoute = createServerRoute({
  endpoint: 'POST /internal/streams/_discovery/_task',
  options: {
    access: 'internal',
    summary: 'Management of the discovery pipeline task',
    description: 'schedules/cancels/acknowledges the discovery pipeline task',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    body: taskActionSchema({
      connectorId: z
        .string()
        .optional()
        .describe(
          'Optional connector ID. If not provided, the default AI connector from settings will be used.'
        ),
      streamNames: z
        .array(z.string())
        .describe('List of stream names to generate discoveries for.')
        .optional(),
    }),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
    logger,
  }): Promise<DiscoveryTaskResult> => {
    const { licensing, uiSettingsClient, taskClient } = await getScopedClients({
      request,
    });

    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const { body } = params;

    const actionParams =
      body.action === 'schedule'
        ? ({
            action: body.action,
            scheduleConfig: {
              taskType: STREAMS_DISCOVERY_PIPELINE_TASK_TYPE,
              taskId: STREAMS_DISCOVERY_PIPELINE_TASK_TYPE,
              params: await (async (): Promise<DiscoveryPipelineTaskParams> => {
                const connectorId = await resolveConnectorId({
                  connectorId: body.connectorId,
                  uiSettingsClient,
                  logger,
                });

                return {
                  connectorId,
                  streamNames: body.streamNames,
                };
              })(),
              request,
            },
          } as const)
        : ({ action: body.action } as const);

    return handleTaskAction<DiscoveryPipelineTaskParams, DiscoveryPipelineResult>({
      taskClient,
      taskId: STREAMS_DISCOVERY_PIPELINE_TASK_TYPE,
      ...actionParams,
    });
  },
});

const discoveryStatusRoute = createServerRoute({
  endpoint: 'POST /internal/streams/_discovery/_status',
  options: {
    access: 'internal',
    summary: 'Check the status of discovery pipeline',
    description: 'Check the status of discovery pipeline',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  handler: async ({ request, getScopedClients, server }): Promise<DiscoveryTaskResult> => {
    const { licensing, uiSettingsClient, taskClient } = await getScopedClients({
      request,
    });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    return taskClient.getStatus<DiscoveryPipelineTaskParams, DiscoveryPipelineResult>(
      STREAMS_DISCOVERY_PIPELINE_TASK_TYPE
    );
  },
});

export const internalDiscoveryRoutes = {
  ...discoveryTaskRoute,
  ...discoveryStatusRoute,
};
