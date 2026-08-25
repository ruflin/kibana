/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { MAX_ARRAY_LENGTH, MAX_ID_LENGTH, MAX_TEXT_LENGTH } from '@kbn/significant-events-schema';
import { STREAMS_API_PRIVILEGES } from '../../../../common/constants';
import { createServerRoute } from '../../create_server_route';
import { assertSignificantEventsAccess } from '../../utils/assert_significant_events_access';
import { createDataViewsService } from '../../../lib/data_views/data_views_service';

const listViewsRoute = createServerRoute({
  endpoint: 'GET /internal/significant_events/views',
  options: {
    access: 'internal',
    summary: 'List configured Significant Events views',
    description:
      'Returns the ES|QL views configured as Significant Events data sources for the current space, including enabled and owned flags.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({}),
  handler: async ({ request, getScopedClients, server, logger }) => {
    const { soClient, streamDataEsClient, licensing, getSignificantEventsAlertingContext } =
      await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing });
    const { alertingV2RulesClient } = await getSignificantEventsAlertingContext();
    const service = createDataViewsService({
      soClient,
      esClient: streamDataEsClient,
      logger,
      alertingV2RulesClient,
    });
    const views = await service.list();
    return { views };
  },
});

const catalogViewsRoute = createServerRoute({
  endpoint: 'GET /internal/significant_events/views/_catalog',
  options: {
    access: 'internal',
    summary: 'List ES|QL views available to add',
    description:
      'Returns ES|QL views from the Elasticsearch catalog that can be added as Significant Events data sources. Plugin-owned system views are omitted.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({}),
  handler: async ({ request, getScopedClients, server, logger }) => {
    const { soClient, streamDataEsClient, licensing, getSignificantEventsAlertingContext } =
      await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing });
    const { alertingV2RulesClient } = await getSignificantEventsAlertingContext();
    const service = createDataViewsService({
      soClient,
      esClient: streamDataEsClient,
      logger,
      alertingV2RulesClient,
    });
    const views = await service.listCatalog();
    return { views };
  },
});

const listDataStreamsRoute = createServerRoute({
  endpoint: 'GET /internal/significant_events/views/_data_streams',
  options: {
    access: 'internal',
    summary: 'List data streams available to create a view',
    description:
      'Returns Elasticsearch data stream names that can be selected when creating a Significant Events view. Hidden (dot-prefixed) data streams are omitted.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({}),
  handler: async ({ request, getScopedClients, server, logger }) => {
    const { soClient, streamDataEsClient, licensing, getSignificantEventsAlertingContext } =
      await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing });
    const { alertingV2RulesClient } = await getSignificantEventsAlertingContext();
    const service = createDataViewsService({
      soClient,
      esClient: streamDataEsClient,
      logger,
      alertingV2RulesClient,
    });
    const dataStreams = await service.listDataStreams();
    return { dataStreams };
  },
});

const createViewRoute = createServerRoute({
  endpoint: 'POST /internal/significant_events/views',
  options: {
    access: 'internal',
    summary: 'Add or create a Significant Events view',
    description:
      'Adds an existing ES|QL view by name, creates an owned view from an ES|QL query, or creates an owned view from selected data streams. Newly added views are enabled.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    body: z.discriminatedUnion('action', [
      z.object({
        action: z.literal('add_existing'),
        name: z.string().min(1).max(MAX_ID_LENGTH),
      }),
      z.object({
        action: z.literal('create'),
        name: z.string().min(1).max(MAX_ID_LENGTH),
        query: z.string().min(1).max(MAX_TEXT_LENGTH),
      }),
      z.object({
        action: z.literal('create_from_data_streams'),
        name: z.string().min(1).max(MAX_ID_LENGTH),
        dataStreams: z.array(z.string().min(1).max(MAX_ID_LENGTH)).min(1).max(MAX_ARRAY_LENGTH),
      }),
    ]),
  }),
  handler: async ({ request, params, getScopedClients, server, logger, getSpaceId }) => {
    const { soClient, streamDataEsClient, licensing, getSignificantEventsAlertingContext } =
      await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing });
    const { alertingV2RulesClient } = await getSignificantEventsAlertingContext();
    const service = createDataViewsService({
      soClient,
      esClient: streamDataEsClient,
      logger,
      alertingV2RulesClient,
    });

    if (params.body.action === 'add_existing') {
      const view = await service.addExisting(params.body.name);
      return { view };
    }

    const spaceId = await getSpaceId(request);

    if (params.body.action === 'create_from_data_streams') {
      const view = await service.createFromDataStreams({
        name: params.body.name,
        dataStreams: params.body.dataStreams,
        spaceId,
      });
      return { view };
    }

    const view = await service.createOwned({
      name: params.body.name,
      query: params.body.query,
      spaceId,
    });
    return { view };
  },
});

const updateViewRoute = createServerRoute({
  endpoint: 'PUT /internal/significant_events/views/{name}',
  options: {
    access: 'internal',
    summary: 'Enable or disable a configured view',
    description:
      'Turns a configured Significant Events view on or off. Disabled views stay listed but are excluded from analysis. Owned Elasticsearch views are not deleted.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({
      name: z.string().min(1).max(MAX_ID_LENGTH),
    }),
    body: z.object({
      enabled: z.boolean(),
    }),
  }),
  handler: async ({ request, params, getScopedClients, server, logger }) => {
    const { soClient, streamDataEsClient, licensing, getSignificantEventsAlertingContext } =
      await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing });
    const { alertingV2RulesClient } = await getSignificantEventsAlertingContext();
    const service = createDataViewsService({
      soClient,
      esClient: streamDataEsClient,
      logger,
      alertingV2RulesClient,
    });
    const view = await service.setEnabled(params.path.name, params.body.enabled);
    return { view };
  },
});

const deleteViewRoute = createServerRoute({
  endpoint: 'DELETE /internal/significant_events/views/{name}',
  options: {
    access: 'internal',
    summary: 'Remove a configured view',
    description:
      'Removes a view from Significant Events data selection. Elasticsearch views are deleted only when they were created from the Views tab.',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    path: z.object({
      name: z.string().min(1).max(MAX_ID_LENGTH),
    }),
  }),
  handler: async ({ request, params, getScopedClients, server, logger }) => {
    const { soClient, streamDataEsClient, licensing, getSignificantEventsAlertingContext } =
      await getScopedClients({ request });
    await assertSignificantEventsAccess({ server, licensing });
    const { alertingV2RulesClient } = await getSignificantEventsAlertingContext();
    const service = createDataViewsService({
      soClient,
      esClient: streamDataEsClient,
      logger,
      alertingV2RulesClient,
    });
    await service.remove(params.path.name);
    return { acknowledged: true };
  },
});

export const internalDataViewsRoutes = {
  ...listViewsRoute,
  ...catalogViewsRoute,
  ...listDataStreamsRoute,
  ...createViewRoute,
  ...updateViewRoute,
  ...deleteViewRoute,
};
