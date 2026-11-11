/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { esql } from '@elastic/esql';
import type { AlertBucket } from '../types';
import { esqlRows, runEsqlRead, toCount } from '../../utils/esql/esql_read';

export interface GetAlertsOptions {
  esClient: ElasticsearchClient;
  signalsIndex: string;
  maxSize: number;
  /** Kept for the callers: one ES|QL query returns up to `maxSize` buckets, so nothing is paged. */
  maxPerPage: number;
  logger: Logger;
}

export const getAlerts = async ({
  esClient,
  signalsIndex,
  maxSize,
  logger,
}: GetAlertsOptions): Promise<AlertBucket[]> => {
  // `maxSize` is the 10,000 result window, which is also the ES|QL result cap, so there is
  // nothing to page. Buckets sort by rule uuid, as the composite aggregation did.
  const query = esql.from([signalsIndex])
    .pipe`WHERE @timestamp >= NOW() - 24 hours AND @timestamp <= NOW()`
    .pipe`STATS doc_count = COUNT(*) BY rule_uuid = kibana.alert.rule.uuid`
    .pipe`WHERE rule_uuid IS NOT NULL`.pipe`SORT rule_uuid ASC`.limit(maxSize);
  logger.debug(() => `Getting alerts with ES|QL query: ${query.print('basic')}`);

  const response = await runEsqlRead({ esClient, query, tolerateUnknownIndex: false });
  const buckets = esqlRows(response).flatMap((row) =>
    typeof row.rule_uuid === 'string'
      ? [{ key: { detectionAlerts: row.rule_uuid }, doc_count: toCount(row.doc_count) }]
      : []
  );
  logger.debug(`Returning alerts response of length: "${buckets.length}"`);
  return buckets;
};
