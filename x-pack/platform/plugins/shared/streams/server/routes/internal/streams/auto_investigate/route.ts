/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { createServerRoute } from '../../../create_server_route';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';
import { STREAMS_AUTO_INVESTIGATION_TASK_TYPE } from '../../../../lib/tasks/task_definitions/auto_investigation';

const triggerAutoInvestigationRoute = createServerRoute({
  endpoint: 'POST /internal/streams/{name}/_investigate',
  options: {
    access: 'internal',
    summary: 'Triggers an auto-investigation for a stream',
    description:
      'Creates a task that runs insight generation for the specified stream, with debouncing to prevent duplicate investigations',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({ name: z.string() }),
    body: z.object({
      connector_id: z.string(),
      alert_id: z.string().optional(),
      trigger_reason: z.string().optional(),
    }),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
  }): Promise<{ task_id: string; status: string }> => {
    const { taskClient, licensing, uiSettingsClient, streamsClient } = await getScopedClients({
      request,
    });

    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });
    await streamsClient.ensureStream(params.path.name);

    const task = await taskClient.run(STREAMS_AUTO_INVESTIGATION_TASK_TYPE, {
      connectorId: params.body.connector_id,
      streamName: params.path.name,
      alertId: params.body.alert_id,
      triggerReason: params.body.trigger_reason,
    });

    return {
      task_id: task.id,
      status: 'scheduled',
    };
  },
});

export const internalAutoInvestigateRoutes = {
  ...triggerAutoInvestigationRoute,
};
