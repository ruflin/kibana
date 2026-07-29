/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest, Logger } from '@kbn/core/server';
import { callEntityStoreApi } from './call_entity_store_api';
import {
  ENTITY_STORE_POC_ENTITY_TYPE,
  KI_PROMOTION_SOURCE_TAG,
  buildServiceEntityId,
} from './constants';

/**
 * Entity Store POC gateway — see `constants.ts` for context on why this file exists
 * instead of consuming `@kbn/entity-store` directly.
 */

export interface EntityStorePocRelationship {
  kind: string;
  targetEntityId: string;
  targetServiceName?: string;
}

export interface EntityStorePocEntity {
  id: string;
  name: string;
  type: string;
  source: string[];
  url?: string;
  firstSeen?: string;
  lastSeen?: string;
  relationships: EntityStorePocRelationship[];
}

export interface EntityStorePocAttachment {
  id: string;
  dashboardId: string;
  dashboardTitle: string;
  createdBy?: string;
  createdAt: string;
}

const RELATIONSHIP_KINDS = [
  'depends_on',
  'communicates_with',
  'owns',
  'owns_inferred',
  'administers',
  'supervises',
  'accesses_frequently',
  'accesses_infrequently',
] as const;

interface RawEntityDoc {
  entity?: {
    id?: string;
    name?: string;
    type?: string;
    // The real API returns this as a plain string per entity (e.g. `"analyzer.log"`),
    // not an array as the field name might suggest — normalized to an array below so
    // the UI has one shape to render regardless of engine version quirks.
    source?: string | string[];
    url?: string;
    lifecycle?: { first_seen?: string; last_seen?: string };
    // `raw_identifiers` is populated by the log-extraction pipeline (ECS-nested, e.g.
    // `{ service: { name: [...] } }` on read). It is *not* usable from this POC's write
    // path — see the comment on `assertServiceRelationship` below — so only `ids` is
    // written, and the target's display name is derived from the EUID on read instead.
    relationships?: Record<
      string,
      { ids?: string[]; raw_identifiers?: { service?: { name?: string[] } } } | undefined
    >;
  };
  service?: { name?: string };
}

interface EntityStoreListEntitiesResponse {
  records?: RawEntityDoc[];
  total?: number;
  page?: number;
  per_page?: number;
}

function toEntityStorePocEntity(doc: RawEntityDoc): EntityStorePocEntity {
  const entity = doc.entity ?? {};
  const relationships: EntityStorePocRelationship[] = [];
  for (const kind of RELATIONSHIP_KINDS) {
    const relationship = entity.relationships?.[kind];
    if (!relationship?.ids?.length) continue;
    for (const targetEntityId of relationship.ids) {
      relationships.push({
        kind,
        targetEntityId,
        // `raw_identifiers` (extraction-only, see file header) wins when present;
        // otherwise fall back to parsing the `service:<name>` EUID we wrote ourselves.
        targetServiceName:
          relationship.raw_identifiers?.service?.name?.[0] ??
          targetEntityId.replace(/^service:/, ''),
      });
    }
  }

  const source = entity.source;
  const normalizedSource = Array.isArray(source) ? source : source ? [source] : [];

  return {
    id: entity.id ?? '',
    name: entity.name ?? doc.service?.name ?? entity.id ?? 'unknown',
    type: entity.type ?? ENTITY_STORE_POC_ENTITY_TYPE,
    source: normalizedSource,
    url: entity.url,
    firstSeen: entity.lifecycle?.first_seen,
    lastSeen: entity.lifecycle?.last_seen,
    relationships,
  };
}

export interface CallEntityStoreApiDeps {
  request: KibanaRequest;
  kibanaBaseUrl: string;
  logger: Logger;
}

export interface ListServiceEntitiesParams {
  deps: CallEntityStoreApiDeps;
  page: number;
  perPage: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface ListServiceEntitiesResult {
  installed: boolean;
  total: number;
  page: number;
  perPage: number;
  records: EntityStorePocEntity[];
}

/**
 * Reads entities through the Entity Store's own public "list entities" CRUD API
 * (`GET /api/security/entity_store/entities`), rather than reading the
 * `entities-latest-{space}` alias directly with `asInternalUser`.
 *
 * The direct-ES-read approach was tried first (see git history / the R2 plan) and
 * rejected: `kibana_system` — the identity behind `asInternalUser` — has no read
 * privileges on `entities-latest-*` (a 403 `security_exception`), so a plugin outside
 * Security cannot read the alias without a bespoke role grant. Proxying through the
 * CRUD API sidesteps that because authorization is enforced there instead, using the
 * forwarded caller's own credentials — which is the same trade-off already accepted for
 * the write paths below. This is itself a POC finding, not an implementation detail.
 *
 * Filters via `filterQuery` on `entity.type` instead of the route's own `entity_types`
 * param, deliberately: `entity_types` matches `entity.EngineMetadata.Type`, a field only
 * ever populated by the extraction *engine*. A `service` entity created directly through
 * the CRUD create API (our KI-promotion path) has no `EngineMetadata` at all, so
 * `entity_types=service` silently excludes every promoted entity from this list — found
 * empirically while testing promotion, not documented anywhere. `entity.type` itself is
 * present on both paths but inconsistently cased (`"Service"` from extraction vs.
 * `"service"` from a manual create), hence `case_insensitive` here rather than a `term`.
 */
export async function listServiceEntities({
  deps,
  page,
  perPage,
  sortField = '@timestamp',
  sortOrder = 'desc',
  search,
}: ListServiceEntitiesParams): Promise<ListServiceEntitiesResult> {
  const typeFilter = {
    term: { 'entity.type': { value: ENTITY_STORE_POC_ENTITY_TYPE, case_insensitive: true } },
  };
  const searchFilter = search
    ? { wildcard: { 'entity.name': { value: `*${search}*` } } }
    : undefined;

  try {
    const response = await callEntityStoreApi<EntityStoreListEntitiesResponse>({
      ...deps,
      method: 'GET',
      path: '/api/security/entity_store/entities',
      query: {
        page: String(page),
        per_page: String(perPage),
        sort_field: sortField,
        sort_order: sortOrder,
        filterQuery: JSON.stringify(
          searchFilter ? { bool: { filter: [typeFilter, searchFilter] } } : typeFilter
        ),
      },
    });

    return {
      installed: true,
      total: response.total ?? 0,
      page: response.page ?? page,
      perPage: response.per_page ?? perPage,
      records: (response.records ?? []).map((doc) => toEntityStorePocEntity(doc)),
    };
  } catch (error) {
    if (isEntityStoreNotInstalledError(error)) {
      return { installed: false, total: 0, page, perPage, records: [] };
    }
    throw error;
  }
}

export async function getServiceEntity({
  deps,
  entityId,
}: {
  deps: CallEntityStoreApiDeps;
  entityId: string;
}): Promise<EntityStorePocEntity | undefined> {
  try {
    const response = await callEntityStoreApi<EntityStoreListEntitiesResponse>({
      ...deps,
      method: 'GET',
      path: '/api/security/entity_store/entities',
      query: {
        // No `entity_types` here either — see `listServiceEntities` above. `entity.id`
        // is a globally unique EUID, so it needs no additional type filter.
        page: '1',
        per_page: '1',
        filterQuery: JSON.stringify({ term: { 'entity.id': entityId } }),
      },
    });
    const doc = response.records?.[0];
    return doc ? toEntityStorePocEntity(doc) : undefined;
  } catch (error) {
    if (isEntityStoreNotInstalledError(error)) {
      return undefined;
    }
    throw error;
  }
}

function isEntityStoreNotInstalledError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode?: number }).statusCode === 404
  );
}

/**
 * Installs the entity store with only the `service` engine, pointed at `logs-*` in
 * addition to whatever the security solution data view already resolves to. This is the
 * POC's answer to "figure out how to load this out of the box": a single install call
 * with these two parameters, no code changes to the entity store itself.
 *
 * Returns `any` rather than `unknown`: this is an unmodeled passthrough of the entity
 * store's own response (no type import — module boundary, see `constants.ts`), and the
 * route layer's serializability guard requires `any` for opaque passthrough JSON — see
 * the comment on `getStatusRoute` in `routes/internal/entity_store_poc/route.ts`.
 */
export async function installEntityStorePocEngine(deps: CallEntityStoreApiDeps): Promise<any> {
  return callEntityStoreApi({
    ...deps,
    method: 'POST',
    path: '/api/security/entity_store/install',
    body: {
      entityTypes: [ENTITY_STORE_POC_ENTITY_TYPE],
      logExtraction: { additionalIndexPatterns: ['logs-*'] },
    },
  });
}

export async function getEntityStorePocStatus(deps: CallEntityStoreApiDeps): Promise<any> {
  return callEntityStoreApi({
    ...deps,
    method: 'GET',
    path: '/api/security/entity_store/status',
    query: { include_components: 'true' },
  });
}

/**
 * Promotes a Knowledge Indicator of type `entity` into a first-class store entity, through
 * the real Entity Store CRUD create API (not the extraction pipeline). Uses the same EUID
 * convention as extraction (`service:<name>`) so a promoted entity that shares a service
 * name with an extracted one lands on the same document rather than a duplicate — the
 * 409-on-conflict semantics of `create` mean a second promotion of the same name will
 * fail, which is itself a finding about how promotion and extraction interact.
 */
export async function promoteKiEntity({
  deps,
  serviceName,
  sourceKiId,
  sourceStreamName,
}: {
  deps: CallEntityStoreApiDeps;
  serviceName: string;
  sourceKiId: string;
  sourceStreamName: string;
}): Promise<any> {
  const entityId = buildServiceEntityId(serviceName);
  return callEntityStoreApi({
    ...deps,
    method: 'POST',
    path: `/api/security/entity_store/entities/${ENTITY_STORE_POC_ENTITY_TYPE}`,
    body: {
      entity: {
        id: entityId,
        name: serviceName,
        type: ENTITY_STORE_POC_ENTITY_TYPE,
        source: [`${KI_PROMOTION_SOURCE_TAG}:${sourceStreamName}:${sourceKiId}`],
      },
      service: { name: serviceName },
    },
  });
}

/**
 * Asserts a relationship between two `service` entities directly through the CRUD update
 * API, with `force=true`. This is the POC path for item 5: no maintainer registration,
 * and therefore no dependency on the entity store's setup contract.
 *
 * Only `entity.relationships.<kind>.ids` is written, deliberately omitting
 * `raw_identifiers` even though its fields are `allowAPIUpdate: true`: the update route
 * runs the request body through `unflattenObject` before validating it (see
 * `entity_store/server/routes/apis/crud/update.ts`), which turns any dotted key —
 * including the schema's own literal `'service.name'` key under `raw_identifiers` — into
 * a nested `{ service: { name: [...] } }` object. The schema then rejects that nested
 * shape as an unrecognized key. In practice this means `raw_identifiers` can only ever
 * be populated by the log-extraction pipeline, never by a manual CRUD update — a real
 * gap this POC surfaces, not a workaround we invented. `getServiceEntity`/
 * `listServiceEntities` fall back to parsing the target service name out of the EUID
 * (`service:<name>`) when `raw_identifiers` is absent.
 */
export async function assertServiceRelationship({
  deps,
  sourceEntityId,
  kind,
  targetServiceName,
}: {
  deps: CallEntityStoreApiDeps;
  sourceEntityId: string;
  kind: (typeof RELATIONSHIP_KINDS)[number];
  targetServiceName: string;
}): Promise<any> {
  const targetEntityId = buildServiceEntityId(targetServiceName);
  return callEntityStoreApi({
    ...deps,
    method: 'PUT',
    path: `/api/security/entity_store/entities/${ENTITY_STORE_POC_ENTITY_TYPE}`,
    query: { force: 'true' },
    body: {
      entity: {
        id: sourceEntityId,
        relationships: {
          [kind]: {
            ids: [targetEntityId],
          },
        },
      },
    },
  });
}

/**
 * Writes a dashboard reference onto `entity.url` through the real CRUD update API. This is
 * *not* a POC hack — `entity.url` is an existing, generic field in the entity schema, so
 * a single attachment-like link is representable today with no schema change. The
 * durability and "is the concept sufficient" questions this raises (only one link, no
 * kind, no created-by/at) are answered by pairing this with `attachment_saved_object.ts`,
 * which is the actual hack: everything `entity.url` cannot express is kept in a Kibana
 * saved object we own instead.
 */
export async function attachDashboardUrlToEntity({
  deps,
  entityId,
  dashboardUrl,
}: {
  deps: CallEntityStoreApiDeps;
  entityId: string;
  dashboardUrl: string;
}): Promise<any> {
  return callEntityStoreApi({
    ...deps,
    method: 'PUT',
    path: `/api/security/entity_store/entities/${ENTITY_STORE_POC_ENTITY_TYPE}`,
    query: { force: 'true' },
    body: {
      entity: {
        id: entityId,
        url: dashboardUrl,
      },
    },
  });
}
