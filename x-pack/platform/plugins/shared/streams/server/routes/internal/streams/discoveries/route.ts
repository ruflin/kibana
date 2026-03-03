/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import { createServerRoute } from '../../../create_server_route';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';

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

export const internalDiscoveryCrudRoutes = {
  ...listDiscoveriesRoute,
  ...getDiscoveryRoute,
  ...updateDiscoveryFeedbackRoute,
  ...listSuggestionsRoute,
  ...updateSuggestionStatusRoute,
};
