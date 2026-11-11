/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { ALERT_INSTANCE_ID } from '@kbn/rule-data-utils';
import type { AttackDiscoveries, Replacements } from '@kbn/elastic-assistant-common';

import { runEsqlRead } from '../esql_helpers';
import { generateAttackDiscoveryAlertHash } from '../transforms/transform_to_alert_documents';

interface DeduplicateAttackDiscoveriesParams {
  attackDiscoveries: AttackDiscoveries;
  computeSha256Hash: (input: string) => string;
  connectorId: string;
  esClient: ElasticsearchClient;
  /**
   * Optional producer identity. MUST match the value the persistence path
   * contributes to the hash, otherwise the lookup computes ids that were never
   * persisted and every run reports its discoveries as new.
   */
  generationSource?: string;
  indexPattern: string;
  logger: Logger;
  ownerInfo: {
    id: string;
    isSchedule: boolean;
  };
  replacements: Replacements | undefined;
  spaceId: string;
}

export const deduplicateAttackDiscoveries = async ({
  attackDiscoveries,
  computeSha256Hash,
  connectorId,
  esClient,
  generationSource,
  indexPattern,
  logger,
  ownerInfo,
  replacements,
  spaceId,
}: DeduplicateAttackDiscoveriesParams): Promise<AttackDiscoveries> => {
  if (!attackDiscoveries || attackDiscoveries.length === 0) {
    return attackDiscoveries;
  }

  const { id: ownerId, isSchedule } = ownerInfo;

  // 1. Transform all attackDiscoveries to alert documents and collect alertUuids
  const alertDocs = attackDiscoveries.map((attack) => {
    const alertHash = generateAttackDiscoveryAlertHash({
      attackDiscovery: attack,
      computeSha256Hash,
      connectorId,
      generationSource,
      ownerId,
      replacements,
      spaceId,
    });
    return { attack, alertHash };
  });
  const alertUuids = alertDocs.map((doc) => doc.alertHash);

  // 2. Search for existing alerts in ES. A missing index has no alerts, so nothing is a duplicate.
  const response = await runEsqlRead({
    esClient,
    query: esql.from(indexPattern.split(',').map((index) => index.trim())).pipe`WHERE ${esql.col(
      ALERT_INSTANCE_ID
    )} IN (${alertUuids.map((uuid) => esql.str(uuid))})`
      .keep(ALERT_INSTANCE_ID)
      .limit(alertUuids.length),
  });

  // 3. Collect found alert IDs
  const foundIds = new Set(
    (response?.values ?? []).flatMap(([instanceId]) =>
      typeof instanceId === 'string' ? [instanceId] : []
    )
  );

  // 4. Filter out duplicates
  const newDiscoveries = alertDocs
    .filter((doc) => !foundIds.has(doc.alertHash))
    .map((doc) => doc.attack);

  const numDuplicates = attackDiscoveries.length - newDiscoveries.length;
  if (numDuplicates > 0) {
    const logPrefix = isSchedule
      ? `Attack Discovery Schedule [${ownerId}]`
      : 'Ad-hoc Attack Discovery';
    logger.info(
      `${logPrefix}: Found ${numDuplicates} duplicate alert(s), skipping report for those.`
    );
    logger.debug(
      () => `${logPrefix}: Duplicated alerts:\n ${JSON.stringify([...foundIds].sort(), null, 2)}`
    );
  }

  return newDiscoveries;
};
