/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Entity Store POC routes — see `lib/entity_store_poc` and the POC issue at
 * AI-Memory kibana/issues/2026-07-29-feat-entity-store-poc-for-observability.md.
 *
 * Every route here is throwaway scaffolding built to answer the POC's feasibility
 * questions, not a production API. It exists so the browser (the "Entities" tab in
 * Significant Events) never has to know the Security Entity Store exists at all — it
 * only talks to this plugin, which is the R2 "proxy route" decision from the POC's
 * implementation plan.
 */

import { z } from '@kbn/zod/v4';
import { createServerRoute } from '../../create_server_route';
import { STREAMS_API_PRIVILEGES } from '../../../../common/constants';
import {
  attachDashboardUrlToEntity,
  assertServiceRelationship,
  getServiceEntity,
  installEntityStorePocEngine,
  getEntityStorePocStatus,
  listServiceEntities,
  promoteKiEntity,
  type EntityStorePocEntity,
} from '../../../lib/entity_store_poc/entity_store_gateway';
import {
  createEntityAttachmentRecord,
  listEntityAttachmentRecords,
  type EntityAttachmentRecord,
} from '../../../lib/entity_store_poc/attachment_saved_object';

const relationshipKindSchema = z.enum([
  'depends_on',
  'communicates_with',
  'owns',
  'owns_inferred',
  'administers',
  'supervises',
  'accesses_frequently',
  'accesses_infrequently',
]);

const listEntitiesRoute = createServerRoute({
  endpoint: 'GET /internal/significant_events/entity_store_poc/entities',
  options: {
    access: 'internal',
    summary: '[Entity Store POC] List service entities from the Security Entity Store',
    description:
      'Reads the entities-latest-{space} alias directly (internal user) so the caller never needs Security index privileges. POC only.',
  },
  security: { authz: { requiredPrivileges: [STREAMS_API_PRIVILEGES.read] } },
  params: z.object({
    query: z.object({
      page: z.coerce.number().int().min(1).optional().default(1),
      per_page: z.coerce.number().int().min(1).max(200).optional().default(25),
      sort_field: z.string().optional(),
      sort_order: z.enum(['asc', 'desc']).optional(),
      search: z.string().optional(),
    }),
  }),
  handler: async ({ params, request, getKibanaBaseUrl, logger }) => {
    const kibanaBaseUrl = await getKibanaBaseUrl();
    const {
      page,
      per_page: perPage,
      sort_field: sortField,
      sort_order: sortOrder,
      search,
    } = params.query;

    return listServiceEntities({
      deps: { request, kibanaBaseUrl, logger },
      page,
      perPage,
      sortField,
      sortOrder,
      search,
    });
  },
});

const getEntityRoute = createServerRoute({
  endpoint: 'GET /internal/significant_events/entity_store_poc/entities/{entityId}',
  options: {
    access: 'internal',
    summary: '[Entity Store POC] Get a single service entity, with attachments',
  },
  security: { authz: { requiredPrivileges: [STREAMS_API_PRIVILEGES.read] } },
  params: z.object({ path: z.object({ entityId: z.string() }) }),
  handler: async ({
    params,
    request,
    getScopedClients,
    getKibanaBaseUrl,
    logger,
  }): Promise<{ entity?: EntityStorePocEntity; attachments: EntityAttachmentRecord[] }> => {
    const { soClient } = await getScopedClients({ request });
    const kibanaBaseUrl = await getKibanaBaseUrl();
    const entityId = decodeURIComponent(params.path.entityId);

    const [entity, attachments] = await Promise.all([
      getServiceEntity({ deps: { request, kibanaBaseUrl, logger }, entityId }),
      listEntityAttachmentRecords(soClient, entityId),
    ]);

    return { entity, attachments };
  },
});

const getStatusRoute = createServerRoute({
  endpoint: 'GET /internal/significant_events/entity_store_poc/status',
  options: {
    access: 'internal',
    summary: '[Entity Store POC] Proxy the Security Entity Store install status',
  },
  security: { authz: { requiredPrivileges: [STREAMS_API_PRIVILEGES.read] } },
  params: z.object({}),
  // `any`, not `unknown`, is required here: this is an unmodeled passthrough of the
  // Security Entity Store's own status response (we don't import its types — module
  // boundary, see file header), and @kbn/server-route-repository's serializability
  // guard rejects `unknown` fields outright (they fail every branch of
  // `ValidateSerializableValue`, which forces the whole handler's return type to
  // `never`). `any` is the framework's intended way to say "opaque passthrough JSON".
  handler: async ({ request, getKibanaBaseUrl, logger }): Promise<{ status: any }> => {
    const kibanaBaseUrl = await getKibanaBaseUrl();
    try {
      return { status: await getEntityStorePocStatus({ request, kibanaBaseUrl, logger }) };
    } catch (error) {
      logger.warn(`entity_store_poc: status check failed: ${String(error)}`);
      return { status: undefined };
    }
  },
});

const installRoute = createServerRoute({
  endpoint: 'POST /internal/significant_events/entity_store_poc/install',
  options: {
    access: 'internal',
    summary:
      '[Entity Store POC] Install the entity store with the service engine only, pointed at logs-*',
  },
  security: { authz: { requiredPrivileges: [STREAMS_API_PRIVILEGES.manage] } },
  params: z.object({}),
  // See getStatusRoute above for why this is `any` and not `unknown`.
  handler: async ({ request, getKibanaBaseUrl, logger }): Promise<{ result: any }> => {
    const kibanaBaseUrl = await getKibanaBaseUrl();
    const result = await installEntityStorePocEngine({ request, kibanaBaseUrl, logger });
    return { result };
  },
});

const listEligibleKisRoute = createServerRoute({
  endpoint: 'GET /internal/significant_events/entity_store_poc/eligible_kis',
  options: {
    access: 'internal',
    summary: '[Entity Store POC] List Knowledge Indicators of type "entity" eligible for promotion',
  },
  security: { authz: { requiredPrivileges: [STREAMS_API_PRIVILEGES.read] } },
  params: z.object({}),
  handler: async ({
    request,
    getScopedClients,
  }): Promise<{
    features: Array<{
      id: string;
      streamName: string;
      title: string;
      subtype?: string;
      confidence: number;
    }>;
  }> => {
    const { streamsClient, getKnowledgeIndicatorClient } = await getScopedClients({ request });
    const streams = await streamsClient.listStreams();
    const streamNames = streams.map((stream) => stream.name);
    if (streamNames.length === 0) {
      return { features: [] };
    }

    const kiClient = await getKnowledgeIndicatorClient();
    const { hits } = await kiClient.getFeatures(streamNames, { type: ['entity'] });

    return {
      features: hits.map((feature) => ({
        id: feature.id,
        streamName: feature.stream_name,
        title: feature.title ?? feature.id,
        subtype: feature.subtype,
        confidence: feature.confidence,
      })),
    };
  },
});

const promoteEntityRoute = createServerRoute({
  endpoint: 'POST /internal/significant_events/entity_store_poc/entities/promote',
  options: {
    access: 'internal',
    summary:
      '[Entity Store POC] Promote a Knowledge Indicator into a store entity via the CRUD API',
  },
  security: { authz: { requiredPrivileges: [STREAMS_API_PRIVILEGES.manage] } },
  params: z.object({
    body: z.object({
      serviceName: z.string().min(1),
      sourceKiId: z.string().min(1),
      sourceStreamName: z.string().min(1),
    }),
  }),
  // See getStatusRoute above for why this is `any` and not `unknown`.
  handler: async ({ params, request, getKibanaBaseUrl, logger }): Promise<{ result: any }> => {
    const kibanaBaseUrl = await getKibanaBaseUrl();
    const result = await promoteKiEntity({
      deps: { request, kibanaBaseUrl, logger },
      serviceName: params.body.serviceName,
      sourceKiId: params.body.sourceKiId,
      sourceStreamName: params.body.sourceStreamName,
    });
    return { result };
  },
});

const assertRelationshipRoute = createServerRoute({
  endpoint: 'POST /internal/significant_events/entity_store_poc/entities/{entityId}/relationships',
  options: {
    access: 'internal',
    summary:
      '[Entity Store POC] Assert a relationship between two service entities via the CRUD API',
  },
  security: { authz: { requiredPrivileges: [STREAMS_API_PRIVILEGES.manage] } },
  params: z.object({
    path: z.object({ entityId: z.string() }),
    body: z.object({ kind: relationshipKindSchema, targetServiceName: z.string().min(1) }),
  }),
  // See getStatusRoute above for why this is `any` and not `unknown`.
  handler: async ({ params, request, getKibanaBaseUrl, logger }): Promise<{ result: any }> => {
    const kibanaBaseUrl = await getKibanaBaseUrl();
    const result = await assertServiceRelationship({
      deps: { request, kibanaBaseUrl, logger },
      sourceEntityId: decodeURIComponent(params.path.entityId),
      kind: params.body.kind,
      targetServiceName: params.body.targetServiceName,
    });
    return { result };
  },
});

const listDashboardsRoute = createServerRoute({
  endpoint: 'GET /internal/significant_events/entity_store_poc/dashboards',
  options: {
    access: 'internal',
    summary: '[Entity Store POC] List dashboards for the attachment picker',
  },
  security: { authz: { requiredPrivileges: [STREAMS_API_PRIVILEGES.read] } },
  params: z.object({}),
  handler: async ({ request, getScopedClients }) => {
    const { soClient } = await getScopedClients({ request });
    const response = await soClient.find<{ title?: string }>({ type: 'dashboard', perPage: 100 });
    return {
      dashboards: response.saved_objects.map((so) => ({
        id: so.id,
        title: so.attributes.title ?? so.id,
      })),
    };
  },
});

const attachDashboardRoute = createServerRoute({
  endpoint: 'POST /internal/significant_events/entity_store_poc/entities/{entityId}/attachments',
  options: {
    access: 'internal',
    summary:
      '[Entity Store POC] Attach a dashboard to an entity: writes entity.url via the CRUD API and records provenance in a saved object',
  },
  security: { authz: { requiredPrivileges: [STREAMS_API_PRIVILEGES.manage] } },
  params: z.object({
    path: z.object({ entityId: z.string() }),
    body: z.object({ dashboardId: z.string().min(1), dashboardTitle: z.string().min(1) }),
  }),
  handler: async ({ params, request, getScopedClients, getKibanaBaseUrl, logger }) => {
    const kibanaBaseUrl = await getKibanaBaseUrl();
    const entityId = decodeURIComponent(params.path.entityId);
    const { dashboardId, dashboardTitle } = params.body;
    const dashboardUrl = `${kibanaBaseUrl.replace(/\/$/, '')}/app/dashboards#/view/${dashboardId}`;

    await attachDashboardUrlToEntity({
      deps: { request, kibanaBaseUrl, logger },
      entityId,
      dashboardUrl,
    });

    const { soClient } = await getScopedClients({ request });
    const record = await createEntityAttachmentRecord(soClient, {
      entityId,
      dashboardId,
      dashboardTitle,
      // Best-effort: resolving a real display name needs the security plugin's authc
      // service, which this route doesn't have wired up. A POC-only fallback is fine.
      createdBy: (request.headers['kbn-username'] as string | undefined) ?? 'unknown',
      createdAt: new Date().toISOString(),
    });

    return { attachment: record, dashboardUrl };
  },
});

export const entityStorePocRoutes = {
  ...listEntitiesRoute,
  ...getEntityRoute,
  ...getStatusRoute,
  ...installRoute,
  ...listEligibleKisRoute,
  ...promoteEntityRoute,
  ...assertRelationshipRoute,
  ...listDashboardsRoute,
  ...attachDashboardRoute,
};
