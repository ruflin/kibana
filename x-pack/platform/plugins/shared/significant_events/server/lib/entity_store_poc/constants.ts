/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Entity Store POC (see AI-Memory kibana/issues/2026-07-29-feat-entity-store-poc-for-observability.md).
 *
 * This module is a deliberately throwaway integration with the Security Entity
 * Store v2 plugin (`x-pack/solutions/security/plugins/entity_store`), built to prove
 * feasibility for Observability, not to ship a feature. It intentionally does not
 * import `@kbn/entity-store`, because that plugin's `group: security` /
 * `visibility: private` manifest makes such an import a module-boundary violation
 * from this `group: platform` plugin. Instead every write *and* read talks to the
 * plugin's public HTTP API (see `call_entity_store_api.ts`), duplicating just enough
 * of its naming convention to be useful. See `entity_store_gateway.ts` for the
 * pointers back to the source of truth for each duplicated constant, and for why
 * direct-ES-alias reads (the original plan) don't work without a bespoke role grant.
 *
 * Only the `service` entity type is used, per the POC scope.
 */

export const ENTITY_STORE_POC_ENTITY_TYPE = 'service' as const;

/** Public API version required by the Security Entity Store's public routes. */
export const ENTITY_STORE_PUBLIC_API_VERSION = '2023-10-31';

/**
 * Builds the EUID-style identifier used by the Entity Store for a `service` entity.
 *
 * Duplicated convention (not code) from `getEuidFromObject('service', ...)` in
 * `x-pack/solutions/security/plugins/entity_store/common/domain/euid/memory.ts`, which
 * produces ids of the form `service:<service.name>`. This is a public, documented ID
 * format (see the entity-store skill and its own tests), so replicating the string
 * format is a data convention, not an import of implementation code.
 */
export const buildServiceEntityId = (serviceName: string): string => `service:${serviceName}`;

/** Source tag written to `entity.source` for entities created by the POC's promotion flow. */
export const KI_PROMOTION_SOURCE_TAG = 'significant_events:ki_promotion';

/** Source tag for the built-in `service` engine's own log extraction, for display purposes only. */
export const LOG_EXTRACTION_SOURCE_PREFIX = 'logs-';
