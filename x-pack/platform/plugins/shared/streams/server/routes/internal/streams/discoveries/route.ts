/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import type { TaskResult } from '@kbn/streams-schema';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import type {
  SuggestionGenerationTaskParams,
} from '../../../../lib/tasks/task_definitions/suggestion_generation';
import {
  STREAMS_SUGGESTION_GENERATION_TASK_TYPE,
} from '../../../../lib/tasks/task_definitions/suggestion_generation';
import type { GenerateSuggestionsResult } from '../../../../lib/significant_events/discovery/generate_suggestions';
import { taskActionSchema } from '../../../../lib/tasks/task_action_schema';
import { createServerRoute } from '../../../create_server_route';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';
import { resolveConnectorId } from '../../../utils/resolve_connector_id';
import { handleTaskAction } from '../../../utils/task_helpers';

const listDiscoveriesRoute = createServerRoute({
  endpoint: 'GET /internal/streams/_discoveries',
  options: {
    access: 'internal',
    summary: 'List discoveries',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    query: z.object({
      streamName: z.string().optional(),
      severity: z.string().optional(),
      level: z.coerce.number().optional(),
      minRelevanceScore: z.coerce.number().optional(),
      size: z.coerce.number().optional(),
    }),
  }),
  handler: async ({ params, request, getScopedClients, server }) => {
    const { licensing, uiSettingsClient, discoveryClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    return discoveryClient.searchDiscoveries(params.query);
  },
});

const getDiscoveryRoute = createServerRoute({
  endpoint: 'GET /internal/streams/_discoveries/{uuid}',
  options: {
    access: 'internal',
    summary: 'Get a discovery by UUID',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    path: z.object({
      uuid: z.string(),
    }),
  }),
  handler: async ({ params, request, getScopedClients, server }) => {
    const { licensing, uiSettingsClient, discoveryClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const discovery = await discoveryClient.getDiscovery(params.path.uuid);
    if (!discovery) {
      throw new Error(`Discovery ${params.path.uuid} not found`);
    }
    return discovery;
  },
});

const updateDiscoveryFeedbackRoute = createServerRoute({
  endpoint: 'POST /internal/streams/_discoveries/{uuid}/_feedback',
  options: {
    access: 'internal',
    summary: 'Update discovery feedback',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({
      uuid: z.string(),
    }),
    body: z.object({
      feedback: z.enum(['useful', 'not_useful']),
    }),
  }),
  handler: async ({ params, request, getScopedClients, server }) => {
    const { licensing, uiSettingsClient, discoveryClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    await discoveryClient.updateDiscovery(params.path.uuid, {
      feedback: params.body.feedback,
    });
    return { acknowledged: true };
  },
});

const listSuggestionsRoute = createServerRoute({
  endpoint: 'GET /internal/streams/_suggestions',
  options: {
    access: 'internal',
    summary: 'List suggestions',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    query: z.object({
      type: z.string().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      size: z.coerce.number().optional(),
    }),
  }),
  handler: async ({ params, request, getScopedClients, server }) => {
    const { licensing, uiSettingsClient, discoveryClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    return discoveryClient.searchSuggestions(params.query);
  },
});

const updateSuggestionStatusRoute = createServerRoute({
  endpoint: 'POST /internal/streams/_suggestions/{uuid}/_status',
  options: {
    access: 'internal',
    summary: 'Update suggestion status',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({
      uuid: z.string(),
    }),
    body: z.object({
      status: z.enum(['accepted', 'dismissed']),
    }),
  }),
  handler: async ({ params, request, getScopedClients, server }) => {
    const { licensing, uiSettingsClient, discoveryClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    await discoveryClient.updateSuggestionStatus(params.path.uuid, params.body.status);
    return { acknowledged: true };
  },
});

export type SuggestionTaskResult = TaskResult<GenerateSuggestionsResult>;

const suggestionTaskRoute = createServerRoute({
  endpoint: 'POST /internal/streams/_suggestions/_task',
  options: {
    access: 'internal',
    summary: 'Management of the suggestion generation task',
    description: 'schedules/cancels/acknowledges the suggestion generation task',
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
    }),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
    logger,
  }): Promise<SuggestionTaskResult> => {
    const { licensing, uiSettingsClient, taskClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const { body } = params;

    const actionParams =
      body.action === 'schedule'
        ? ({
            action: body.action,
            scheduleConfig: {
              taskType: STREAMS_SUGGESTION_GENERATION_TASK_TYPE,
              taskId: STREAMS_SUGGESTION_GENERATION_TASK_TYPE,
              params: await (async (): Promise<SuggestionGenerationTaskParams> => {
                const connectorId = await resolveConnectorId({
                  connectorId: body.connectorId,
                  uiSettingsClient,
                  logger,
                });
                return { connectorId };
              })(),
              request,
            },
          } as const)
        : ({ action: body.action } as const);

    return handleTaskAction<SuggestionGenerationTaskParams, GenerateSuggestionsResult>({
      taskClient,
      taskId: STREAMS_SUGGESTION_GENERATION_TASK_TYPE,
      ...actionParams,
    });
  },
});

const suggestionStatusRoute = createServerRoute({
  endpoint: 'POST /internal/streams/_suggestions/_status',
  options: {
    access: 'internal',
    summary: 'Check the status of suggestion generation',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  handler: async ({ request, getScopedClients, server }): Promise<SuggestionTaskResult> => {
    const { licensing, uiSettingsClient, taskClient } = await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    return taskClient.getStatus<SuggestionGenerationTaskParams, GenerateSuggestionsResult>(
      STREAMS_SUGGESTION_GENERATION_TASK_TYPE
    );
  },
});

export const internalDiscoveryCrudRoutes = {
  ...listDiscoveriesRoute,
  ...getDiscoveryRoute,
  ...updateDiscoveryFeedbackRoute,
  ...listSuggestionsRoute,
  ...updateSuggestionStatusRoute,
  ...suggestionTaskRoute,
  ...suggestionStatusRoute,
};
