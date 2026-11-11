/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import type { Logger } from '@kbn/logging';
import { ALERT_STATUS_ACTIVE } from '@kbn/rule-data-utils';
import { runEsqlRows } from '../../lib/esql_read';

export interface GetAlertSnoozeSnapshotParams {
  indices: string[];
  alertId: string;
  ruleId: string;
  fields: string[];
}

interface GetAlertSnoozeSnapshotParamsWithDeps extends GetAlertSnoozeSnapshotParams {
  logger: Logger;
  esClient: ElasticsearchClient;
}

export async function getAlertSnoozeSnapshot({
  indices,
  alertId,
  ruleId,
  fields,
  logger,
  esClient,
}: GetAlertSnoozeSnapshotParamsWithDeps): Promise<Record<string, unknown> | null> {
  try {
    if (indices.length === 0) {
      return null;
    }
    // `_source` keeps the requested fields as stored, including the ones missing from the mappings.
    const [row] = await runEsqlRows({
      esClient,
      query: esql.from(indices, ['_source']).pipe`WHERE kibana.alert.rule.uuid == ${{
        ruleId,
      }} AND kibana.alert.status == ${{
        status: ALERT_STATUS_ACTIVE,
      }} AND kibana.alert.instance.id == ${{ alertId }}`.limit(1),
    });

    if (!row) {
      return null;
    }

    // Alert documents use flat dot-notation keys in _source
    const source = (row._source ?? {}) as Record<string, unknown>;
    return fields.reduce<Record<string, unknown>>((snapshot, field) => {
      const value = source[field];
      snapshot[field] = value !== undefined ? value : null;
      return snapshot;
    }, {});
  } catch (error) {
    logger.error(
      `Error fetching snooze snapshot for alertId: ${alertId} and ruleId: ${ruleId} - ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}
