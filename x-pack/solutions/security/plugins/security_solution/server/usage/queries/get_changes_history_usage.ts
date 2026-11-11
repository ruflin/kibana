/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { esql } from '@elastic/esql';
import { DATA_STREAM_NAME } from '@kbn/change-history';
import { RuleChangeTrackingAction } from '@kbn/alerting-types';
import { SecurityRuleChangeTrackingAction } from '../../../common/detection_engine/rule_management/rule_change_tracking';
import type { ChangesHistoryUsage } from '../detections/rules/types';
import { esqlRows, runEsqlRead, toCount, toInListParams } from '../../utils/esql/esql_read';

/**
 * The `event.action` values that count as a "revision saved" for SBT-01.
 * Matches the UI's own `DIFFABLE_CHANGE_ACTIONS` definition (the "is this a
 * diffable revision" taxonomy already used by the changes-history timeline)
 * so telemetry never silently diverges from what the feature itself surfaces
 * as a revision. See the parity test in get_changes_history_usage.test.ts.
 */
export const REVISION_SAVED_ACTIONS: readonly string[] = [
  RuleChangeTrackingAction.ruleUpdate,
  RuleChangeTrackingAction.ruleCreate,
  SecurityRuleChangeTrackingAction.ruleInstall,
  SecurityRuleChangeTrackingAction.ruleUpgrade,
  SecurityRuleChangeTrackingAction.ruleDuplicate,
  SecurityRuleChangeTrackingAction.ruleImport,
  SecurityRuleChangeTrackingAction.ruleRevert,
  SecurityRuleChangeTrackingAction.ruleRestore,
];

/**
 * Derives the SBT-01 ("revision saved") and SBT-02 ("rule restored") usage
 * counters as two cluster-wide document counts over a rolling `now-24h`..`now`
 * window, aggregated from the `.kibana_change_history` data stream.
 *
 * Degrades to `{ revision_saved: 0, rule_restored: 0 }` (never throws) on
 * any ES error, including `index_not_found_exception` when
 * `xpack.alerting.ruleChangeTracking.enabled` is disabled (the default) and
 * the data stream does not exist. The catch is local so a missing index
 * only zeros these two fields, never the whole `detection_rules` metrics
 * group.
 * @param esClient the elastic client which should be a system based client
 * @param logger The kibana logger
 * @returns The changes-history usage counts
 */
export const getChangesHistoryUsage = async ({
  esClient,
  logger,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
}): Promise<ChangesHistoryUsage> => {
  try {
    const { placeholders, params } = toInListParams('revision', REVISION_SAVED_ACTIONS);
    // The `.kibana_change_history` fields are scalar keywords and a date, so plain `WHERE` works.
    const query = esql(
      `FROM ${DATA_STREAM_NAME}
        | WHERE event.module == "security" AND event.dataset == "alerting-rules" AND object.type == "alert"
            AND @timestamp >= NOW() - 24 hours AND @timestamp <= NOW()
        | STATS revision_saved = COUNT(*) WHERE event.action IN (${placeholders}),
            rule_restored = COUNT(*) WHERE event.action == ?restored`,
      { ...params, restored: SecurityRuleChangeTrackingAction.ruleRestore }
    );
    logger.debug(() => `Getting changes-history usage with query: ${query.print('basic')}`);

    const response = await runEsqlRead({ esClient, query, tolerateUnknownIndex: false });

    logger.debug(() => `Raw ES|QL results of changes-history usage: ${JSON.stringify(response)}`);

    const [row] = esqlRows(response);

    return {
      revision_saved: toCount(row?.revision_saved),
      rule_restored: toCount(row?.rule_restored),
    };
  } catch (error) {
    logger.debug(
      `Encountered unexpected condition getting changes-history usage. Error message is: "${error.message}". Error is: "${error}". Telemetry for "changes history" being skipped.`
    );
    return { revision_saved: 0, rule_restored: 0 };
  }
};
