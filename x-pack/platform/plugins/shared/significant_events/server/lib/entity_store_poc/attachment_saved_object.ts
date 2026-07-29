/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SavedObjectsClientContract, SavedObjectsType } from '@kbn/core/server';
import { schema, type TypeOf } from '@kbn/config-schema';

/**
 * Entity Store POC — provenance sidecar for entity attachments.
 *
 * The entity store has no attachment concept: an entity is a fixed, strictly validated
 * schema per type, `additionalProperties: false`. The one generic, already-existing field
 * that can hold an artifact reference is `entity.url` (see `entity_store_gateway.ts`,
 * `attachDashboardUrlToEntity`), which proves a *single* link works, but it cannot express
 * "several attachments", "what kind of artifact", or "who attached it and when".
 *
 * This saved object type is the actual POC hack for everything `entity.url` cannot carry.
 * It is entirely outside the entity store, owned by this plugin, and keyed by the
 * entity's id. Its existence — needing a second, unrelated storage mechanism to make a
 * one-artifact attachment minimally useful — is itself the finding for item 4: whatever we
 * demonstrate here is evidence *against* the entity's own fields being a sufficient
 * attachment model, not evidence for it.
 */

export const ENTITY_STORE_POC_ATTACHMENT_SO_TYPE = 'significant-events-entity-attachment';

const entityAttachmentAttributesV1 = schema.object({
  entityId: schema.string(),
  dashboardId: schema.string(),
  dashboardTitle: schema.string(),
  createdBy: schema.maybe(schema.string()),
  createdAt: schema.string(),
});

export type EntityAttachmentAttributes = TypeOf<typeof entityAttachmentAttributesV1>;

export const getEntityAttachmentSavedObjectType = (): SavedObjectsType => ({
  name: ENTITY_STORE_POC_ATTACHMENT_SO_TYPE,
  // Not `hidden: true`: the routes use the plugin's default scoped `soClient`
  // (`coreStart.savedObjects.getScopedClient(request)`, no `includedHiddenTypes`), which
  // 404s on hidden types with "Unsupported saved object type". A real implementation
  // would either hide this and thread an internal client through, or (more likely) not
  // need a bespoke saved object at all — see the file header.
  hidden: false,
  namespaceType: 'single',
  mappings: {
    dynamic: false,
    properties: {
      entityId: { type: 'keyword', ignore_above: 1024 },
      dashboardId: { type: 'keyword', ignore_above: 1024 },
      dashboardTitle: { type: 'text' },
      createdBy: { type: 'keyword', ignore_above: 1024 },
      createdAt: { type: 'date' },
    },
  },
  management: {
    importableAndExportable: false,
  },
  modelVersions: {
    '1': {
      changes: [],
      schemas: {
        forwardCompatibility: entityAttachmentAttributesV1.extends({}, { unknowns: 'ignore' }),
        create: entityAttachmentAttributesV1,
      },
    },
  },
});

export interface EntityAttachmentRecord extends EntityAttachmentAttributes {
  id: string;
}

export async function createEntityAttachmentRecord(
  soClient: SavedObjectsClientContract,
  attributes: EntityAttachmentAttributes
): Promise<EntityAttachmentRecord> {
  const created = await soClient.create<EntityAttachmentAttributes>(
    ENTITY_STORE_POC_ATTACHMENT_SO_TYPE,
    attributes
  );
  return { id: created.id, ...created.attributes };
}

export async function listEntityAttachmentRecords(
  soClient: SavedObjectsClientContract,
  entityId: string
): Promise<EntityAttachmentRecord[]> {
  const response = await soClient.find<EntityAttachmentAttributes>({
    type: ENTITY_STORE_POC_ATTACHMENT_SO_TYPE,
    search: `"${entityId}"`,
    searchFields: ['entityId'],
    perPage: 50,
  });
  return response.saved_objects
    .filter((so) => so.attributes.entityId === entityId)
    .map((so) => ({ id: so.id, ...so.attributes }));
}
