/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { EsqlQueryResponse } from '@elastic/elasticsearch/lib/api/types';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { Logger } from '@kbn/logging';
import { esqlRows, runEsql } from '../../../../lib/esql/esql_read';
import { getRiskScoreLatestIndex } from '../../../../../common/entity_analytics/risk_engine/indices';
import { getAssetCriticalityIndex } from '../../../../../common/entity_analytics/asset_criticality/indices';

export type EntityKind = 'host' | 'user';

export interface EntityEnrichment {
  /** Entity risk level from the Risk Engine: Critical | High | Moderate | Low | Unknown. */
  riskLevel?: string;
  /** Normalized entity risk score (0-100) from the Risk Engine. */
  riskScoreNorm?: number;
  /** Asset criticality level: extreme_impact | high_impact | medium_impact | low_impact. */
  criticality?: string;
}

/** Keyed by `${kind}:${name}`, e.g. `host:WIN-DC01` or `user:administrator`. */
export type EntityEnrichmentMap = Map<string, EntityEnrichment>;

export const entityKey = (kind: EntityKind, name: string): string => `${kind}:${name}`;

interface EnrichEntitiesParams {
  esClient: ElasticsearchClient;
  spaceId: string;
  logger: Logger;
  hostNames: string[];
  userNames: string[];
}

type HitFields = Record<string, unknown[]>;

/** Each row of an ES|QL response as the `fields` API shapes a hit: every value is an array. */
const toHitFields = (response: EsqlQueryResponse | undefined): HitFields[] =>
  esqlRows(response).map((row) =>
    Object.fromEntries(
      Object.entries(row)
        .filter(([, value]) => value != null)
        .map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
    )
  );

const firstString = (fields: HitFields, key: string): string | undefined => {
  const value = fields[key]?.[0];
  return typeof value === 'string' ? value : undefined;
};

const firstNumber = (fields: HitFields, key: string): number | undefined => {
  const value = fields[key]?.[0];
  return typeof value === 'number' ? value : undefined;
};

const upsert = (map: EntityEnrichmentMap, key: string, patch: EntityEnrichment): void => {
  map.set(key, { ...map.get(key), ...patch });
};

/**
 * Fetch the latest Risk Engine score for each host/user and merge into the map.
 * Risk-score-latest docs are nested per entity type (host.risk.* / user.risk.*).
 */
const fetchRiskScores = async (
  { esClient, spaceId, hostNames, userNames }: Omit<EnrichEntitiesParams, 'logger'>,
  map: EntityEnrichmentMap
): Promise<void> => {
  if (hostNames.length === 0 && userNames.length === 0) return;

  const source = esql.from([getRiskScoreLatestIndex(spaceId)]);
  const filtered =
    hostNames.length > 0 && userNames.length > 0
      ? source.pipe`WHERE host.name IN (${{ hostNames }}) OR user.name IN (${{ userNames }})`
      : hostNames.length > 0
      ? source.pipe`WHERE host.name IN (${{ hostNames }})`
      : source.pipe`WHERE user.name IN (${{ userNames }})`;

  const result = await runEsql({
    esClient,
    query: filtered
      .keep(
        'host.name',
        'host.risk.calculated_level',
        'host.risk.calculated_score_norm',
        'user.name',
        'user.risk.calculated_level',
        'user.risk.calculated_score_norm'
      )
      .limit(hostNames.length + userNames.length),
    ignoreUnknownIndex: true,
  });

  for (const fields of toHitFields(result)) {
    const hostName = firstString(fields, 'host.name');
    if (hostName) {
      upsert(map, entityKey('host', hostName), {
        riskLevel: firstString(fields, 'host.risk.calculated_level'),
        riskScoreNorm: firstNumber(fields, 'host.risk.calculated_score_norm'),
      });
    }
    const userName = firstString(fields, 'user.name');
    if (userName) {
      upsert(map, entityKey('user', userName), {
        riskLevel: firstString(fields, 'user.risk.calculated_level'),
        riskScoreNorm: firstNumber(fields, 'user.risk.calculated_score_norm'),
      });
    }
  }
};

/**
 * Fetch asset criticality for each host/user and merge into the map. Asset-criticality
 * docs are keyed by `{ id_field, id_value }` (e.g. id_field=host.name, id_value=WIN-DC01).
 */
const fetchCriticalities = async (
  { esClient, spaceId, hostNames, userNames }: Omit<EnrichEntitiesParams, 'logger'>,
  map: EntityEnrichmentMap
): Promise<void> => {
  if (hostNames.length === 0 && userNames.length === 0) return;

  const source = esql.from([getAssetCriticalityIndex(spaceId)]);
  const filtered =
    hostNames.length > 0 && userNames.length > 0
      ? source.pipe`WHERE (id_field == "host.name" AND id_value IN (${{
          hostNames,
        }})) OR (id_field == "user.name" AND id_value IN (${{ userNames }}))`
      : hostNames.length > 0
      ? source.pipe`WHERE id_field == "host.name" AND id_value IN (${{ hostNames }})`
      : source.pipe`WHERE id_field == "user.name" AND id_value IN (${{ userNames }})`;

  const result = await runEsql({
    esClient,
    query: filtered
      .keep('id_field', 'id_value', 'criticality_level')
      .limit(hostNames.length + userNames.length),
    ignoreUnknownIndex: true,
  });

  for (const fields of toHitFields(result)) {
    const idField = firstString(fields, 'id_field');
    const idValue = firstString(fields, 'id_value');
    const criticality = firstString(fields, 'criticality_level');
    const kind: EntityKind | undefined =
      idField === 'host.name' ? 'host' : idField === 'user.name' ? 'user' : undefined;
    if (idValue && criticality && kind) {
      upsert(map, entityKey(kind, idValue), { criticality });
    }
  }
};

/**
 * Best-effort enrichment of entities with Risk Engine scores and asset criticality.
 *
 * Both lookups are independent and wrapped so a failure (missing index, insufficient
 * license, transform not running) never breaks triage — it just yields no enrichment for
 * the affected signal. The caller folds whatever is returned into group prioritization.
 */
export const enrichEntities = async ({
  esClient,
  spaceId,
  logger,
  hostNames,
  userNames,
}: EnrichEntitiesParams): Promise<EntityEnrichmentMap> => {
  const map: EntityEnrichmentMap = new Map();
  const uniqueHosts = [...new Set(hostNames)];
  const uniqueUsers = [...new Set(userNames)];
  if (uniqueHosts.length === 0 && uniqueUsers.length === 0) return map;

  const args = { esClient, spaceId, hostNames: uniqueHosts, userNames: uniqueUsers };

  await Promise.all([
    fetchRiskScores(args, map).catch((err) => {
      logger.debug(
        `[alert-triage] entity risk enrichment skipped: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }),
    fetchCriticalities(args, map).catch((err) => {
      logger.debug(
        `[alert-triage] asset criticality enrichment skipped: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }),
  ]);

  return map;
};
