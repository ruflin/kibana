/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import {
  basePersistedInsightSchema,
  insightStatusSchema,
  type PersistedInsight,
} from '@kbn/streams-schema';
import { createServerRoute } from '../../../create_server_route';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import { assertSignificantEventsAccess } from '../../../utils/assert_significant_events_access';

const upsertInsightRoute = createServerRoute({
  endpoint: 'POST /internal/streams/{name}/insights',
  options: {
    access: 'internal',
    summary: 'Creates an insight for a stream',
    description: 'Creates a new insight and persists it to the insights index',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({ name: z.string() }),
    body: basePersistedInsightSchema,
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
  }): Promise<{ insight: PersistedInsight }> => {
    const { insightClient, licensing, uiSettingsClient, streamsClient } = await getScopedClients({
      request,
    });

    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });
    await streamsClient.ensureStream(params.path.name);

    const insight = await insightClient.upsert(params.path.name, params.body);

    return { insight };
  },
});

const bulkInsightsRoute = createServerRoute({
  endpoint: 'POST /internal/streams/{name}/insights/_bulk',
  options: {
    access: 'internal',
    summary: 'Bulk create insights for a stream',
    description: 'Creates multiple insights in a single operation',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({ name: z.string() }),
    body: z.object({
      insights: z.array(basePersistedInsightSchema),
    }),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
  }): Promise<{ insights: PersistedInsight[] }> => {
    const { insightClient, licensing, uiSettingsClient, streamsClient } = await getScopedClients({
      request,
    });

    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });
    await streamsClient.ensureStream(params.path.name);

    const insights = await insightClient.bulkUpsert(params.path.name, params.body.insights);

    return { insights };
  },
});

const listInsightsRoute = createServerRoute({
  endpoint: 'GET /internal/streams/{name}/insights',
  options: {
    access: 'internal',
    summary: 'Lists insights for a stream',
    description: 'Fetches all insights for the specified stream',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    path: z.object({ name: z.string() }),
    query: z.optional(
      z.object({
        status: z.string().optional(),
        impact: z.string().optional(),
        category: z.string().optional(),
      })
    ),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
  }): Promise<{ insights: PersistedInsight[] }> => {
    const { insightClient, licensing, uiSettingsClient, streamsClient } = await getScopedClients({
      request,
    });

    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });
    await streamsClient.ensureStream(params.path.name);

    const { hits: insights } = await insightClient.getInsights(params.path.name, {
      status: params.query?.status as PersistedInsight['status'] | undefined,
      impact: params.query?.impact,
      category: params.query?.category,
    });

    return { insights };
  },
});

const listAllInsightsRoute = createServerRoute({
  endpoint: 'GET /internal/streams/_insights/all',
  options: {
    access: 'internal',
    summary: 'Lists all insights across streams',
    description: 'Fetches all insights the user has access to',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  handler: async ({
    request,
    getScopedClients,
    server,
  }): Promise<{ insights: PersistedInsight[] }> => {
    const { insightClient, licensing, uiSettingsClient, streamsClient } = await getScopedClients({
      request,
    });

    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

    const streams = await streamsClient.listStreams();
    const streamNames = streams.map((stream) => stream.name);

    const { hits: insights } = await insightClient.getAllInsights(streamNames);

    return { insights };
  },
});

const updateInsightStatusRoute = createServerRoute({
  endpoint: 'PUT /internal/streams/{name}/insights/{uuid}',
  options: {
    access: 'internal',
    summary: 'Updates an insight status',
    description: 'Updates the status of a specific insight',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({ name: z.string(), uuid: z.string() }),
    body: z.object({
      status: insightStatusSchema,
    }),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
  }): Promise<{ insight: PersistedInsight }> => {
    const { insightClient, licensing, uiSettingsClient, streamsClient } = await getScopedClients({
      request,
    });

    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });
    await streamsClient.ensureStream(params.path.name);

    const insight = await insightClient.updateStatus(
      params.path.name,
      params.path.uuid,
      params.body.status
    );

    return { insight };
  },
});

const deleteInsightRoute = createServerRoute({
  endpoint: 'DELETE /internal/streams/{name}/insights/{uuid}',
  options: {
    access: 'internal',
    summary: 'Deletes an insight',
    description: 'Deletes the specified insight',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({ name: z.string(), uuid: z.string() }),
  }),
  handler: async ({
    params,
    request,
    getScopedClients,
    server,
  }): Promise<{ acknowledged: boolean }> => {
    const { insightClient, licensing, uiSettingsClient, streamsClient } = await getScopedClients({
      request,
    });

    await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });
    await streamsClient.ensureStream(params.path.name);

    await insightClient.deleteInsight(params.path.name, params.path.uuid);

    return { acknowledged: true };
  },
});

export const internalInsightsCrudRoutes = {
  ...upsertInsightRoute,
  ...bulkInsightsRoute,
  ...listInsightsRoute,
  ...listAllInsightsRoute,
  ...updateInsightStatusRoute,
  ...deleteInsightRoute,
};
