/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import type { SignificantEventsStatsResponse } from '../../../../common/stats';
import { STREAMS_API_PRIVILEGES } from '../../../../common/constants';
import { getStatsForRange } from '../../../lib/stats/get_stats_for_range';
import { createServerRoute } from '../../create_server_route';
import { assertSignificantEventsAccess } from '../../utils/assert_significant_events_access';

const statsRoute = createServerRoute({
  endpoint: 'GET /internal/significant_events/stats',
  options: {
    access: 'internal',
    summary: 'Significant events usage statistics',
    description:
      'Aggregates workflow runs, token usage, tool calls, conversations, and artifact counts for the selected time range.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    query: z.object({
      from: z.iso.datetime(),
      to: z.iso.datetime(),
      interval: z.enum(['1h', '1d']).default('1d'),
    }),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
    getSpaceId,
  }): Promise<SignificantEventsStatsResponse> => {
    const { licensing, scopedClusterClient, uiSettingsClient } = await getScopedClients({
      request,
    });

    await assertSignificantEventsAccess({ server, licensing });

    const spaceId = await getSpaceId(request);

    return getStatsForRange({
      esClient: scopedClusterClient.asInternalUser,
      uiSettingsClient,
      spaceId,
      from: params.query.from,
      to: params.query.to,
      interval: params.query.interval,
    });
  },
});

export const internalStatsRoutes = {
  ...statsRoute,
};
