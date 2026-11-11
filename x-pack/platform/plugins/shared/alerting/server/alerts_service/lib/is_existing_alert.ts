/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import type { Logger } from '@kbn/logging';
import { runEsqlRows } from '../../lib/esql_read';

export interface IsExistingAlertParams {
  indices: string[];
  alertId: string;
  ruleId: string;
}

interface IsExistingAlertParamsWithDeps extends IsExistingAlertParams {
  logger: Logger;
  esClient: ElasticsearchClient;
}

export async function isExistingAlert({
  indices,
  alertId,
  ruleId,
  logger,
  esClient,
}: IsExistingAlertParamsWithDeps): Promise<boolean> {
  try {
    if (indices.length === 0) {
      return false;
    }
    const rows = await runEsqlRows({
      esClient,
      query: esql.from(indices).pipe`WHERE kibana.alert.rule.uuid == ${{
        ruleId,
      }} AND kibana.alert.instance.id == ${{
        alertId,
      }}`.limit(1),
    });

    return rows.length > 0;
  } catch (error) {
    logger.error(
      `Error checking for existing alert with alertId: ${alertId} and ruleId: ${ruleId} - ${error.message}`
    );
    return false;
  }
}
