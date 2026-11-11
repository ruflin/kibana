/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { runEsqlRead } from '../esql_helpers';
import type { DiscoveryWithAlertIds } from './types';
import { getAlertIds } from './types';
import { getValidDiscoveries } from './get_valid_discoveries';
import { logFilteredDiscoveries } from './log_filtered_discoveries';
import { logUnverifiableDiscoveries } from './log_unverifiable_discoveries';

const ALERT_IDS_BATCH_SIZE = 1000;

interface FilterHallucinatedAlertsParams<T extends DiscoveryWithAlertIds> {
  alertsIndexPattern: string;
  attackDiscoveries: T[];
  esClient: ElasticsearchClient;
  logger: Logger;
}

/**
 * Queries Elasticsearch to filter out generated attack discoveries with hallucinated alert IDs.
 * Works with both camelCase (alertIds) and snake_case (alert_ids) field naming conventions.
 *
 * **Important:** This function only returns *verifiable* discoveries — those whose alert IDs
 * all exist in Elasticsearch. Discoveries with empty alert IDs are filtered out because they
 * cannot be verified. Callers that need to preserve unverifiable discoveries must handle them
 * separately (e.g. by partitioning before calling this function and re-combining after).
 */
export const filterHallucinatedAlerts = async <T extends DiscoveryWithAlertIds>({
  alertsIndexPattern,
  attackDiscoveries,
  esClient,
  logger,
}: FilterHallucinatedAlertsParams<T>): Promise<T[]> => {
  if (attackDiscoveries.length === 0) {
    return attackDiscoveries;
  }

  // 1. Filter out discoveries with empty alertIds (cannot be verified)
  const verifiableDiscoveries = attackDiscoveries.filter((discovery) => {
    const alertIds = getAlertIds(discovery);
    return alertIds.length > 0;
  });

  logUnverifiableDiscoveries(logger, attackDiscoveries, verifiableDiscoveries);

  if (verifiableDiscoveries.length === 0) {
    return [];
  }

  // 2. Collect all unique alert IDs from all discoveries (deduplicate to minimize ES query size)
  const uniqueAlertIds = new Set(
    verifiableDiscoveries.flatMap((discovery) => getAlertIds(discovery))
  );

  // 3. Query ES for all unique alert IDs (in batches, to bound the size of each query).
  // A missing alerts index has no alerts, so every ID is unknown.
  const existingAlertIds = new Set<string>();
  const ids = [...uniqueAlertIds];
  for (let offset = 0; offset < ids.length; offset += ALERT_IDS_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + ALERT_IDS_BATCH_SIZE);
    const response = await runEsqlRead({
      esClient,
      query: esql.from([alertsIndexPattern], ['_id']).pipe`WHERE _id IN (${batch.map((id) =>
        esql.str(id)
      )})`
        .keep('_id')
        .limit(batch.length),
    });

    // 4. Collect the alert IDs that actually exist
    for (const [id] of response?.values ?? []) {
      if (typeof id === 'string') existingAlertIds.add(id);
    }
  }

  const validDiscoveries = getValidDiscoveries({
    attackDiscoveries: verifiableDiscoveries,
    existingAlertIds,
  });

  // 5. Log information about filtered discoveries
  logFilteredDiscoveries(logger, attackDiscoveries, validDiscoveries, existingAlertIds);

  return validDiscoveries;
};
