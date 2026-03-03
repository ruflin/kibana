/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { STREAMS_API_PRIVILEGES } from '../../../../../common/constants';
import { createServerRoute } from '../../../create_server_route';
import { EntityStoreClient } from '../../../../lib/entity_store/entity_store_client';

const listEntitiesRoute = createServerRoute({
  endpoint: 'GET /internal/streams/_entities',
  options: {
    access: 'internal',
    summary: 'List entities from the Entity Store',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.read],
    },
  },
  params: z.object({
    query: z.object({
      type: z.string().optional(),
      size: z.coerce.number().optional(),
    }),
  }),
  handler: async ({ params, request, getScopedClients, logger }) => {
    const { scopedClusterClient } = await getScopedClients({ request });
    const entityClient = new EntityStoreClient(scopedClusterClient.asCurrentUser, logger);
    return entityClient.listEntities(params.query);
  },
});

const pushEntityRoute = createServerRoute({
  endpoint: 'POST /internal/streams/_entities',
  options: {
    access: 'internal',
    summary: 'Push an entity definition to the Entity Store',
  },
  security: {
    authz: {
      requiredPrivileges: [STREAMS_API_PRIVILEGES.manage],
    },
  },
  params: z.object({
    body: z.object({
      type: z.enum(['host', 'user', 'service', 'generic']),
      name: z.string(),
      metadata: z.record(z.unknown()).optional(),
    }),
  }),
  handler: async ({ params, request, getScopedClients, logger }) => {
    const { scopedClusterClient } = await getScopedClients({ request });
    const entityClient = new EntityStoreClient(scopedClusterClient.asCurrentUser, logger);
    return entityClient.pushEntityDefinition(params.body);
  },
});

export const internalEntityStoreRoutes = {
  ...listEntitiesRoute,
  ...pushEntityRoute,
};
