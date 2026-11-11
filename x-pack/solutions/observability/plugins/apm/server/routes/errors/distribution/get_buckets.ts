/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { rangeQuery, kqlQuery } from '@kbn/observability-plugin/server';
import { ApmDocumentType } from '../../../../common/document_type';
import { ERROR_GROUP_ID, SERVICE_NAME, TRANSACTION_NAME } from '../../../../common/es_fields/apm';
import { RollupInterval } from '../../../../common/rollup';
import { environmentQuery } from '../../../../common/utils/environment_query';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlRows } from '../../../lib/helpers/esql_read';
import { boolFilter, fromApmIndex, getHistogramKeys } from '../../../lib/helpers/esql_apm';

export async function getBuckets({
  environment,
  kuery,
  serviceName,
  groupId,
  transactionName,
  bucketSize,
  apmEventClient,
  start,
  end,
}: {
  environment: string;
  kuery: string;
  serviceName: string;
  groupId?: string;
  transactionName?: string;
  bucketSize: number;
  apmEventClient: APMEventClient;
  start: number;
  end: number;
}) {
  const response = await apmEventClient.esql('get_error_distribution_buckets', {
    apm: {
      sources: [
        {
          documentType: ApmDocumentType.ErrorEvent,
          rollupInterval: RollupInterval.None,
        },
      ],
    },
    query: (index) => {
      let query = fromApmIndex(index).pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ serviceName }}`;
      if (groupId) {
        query = query.pipe`WHERE ${esql.col(ERROR_GROUP_ID)} == ${{ groupId }}`;
      }
      if (transactionName) {
        query = query.pipe`WHERE ${esql.col(TRANSACTION_NAME)} == ${{ transactionName }}`;
      }
      // The same buckets as a histogram aggregation on the timestamp in epoch milliseconds.
      return query.pipe`STATS doc_count = COUNT(*) BY bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ${{
        bucketSize,
      }}`.pipe`SORT bucket ASC`.limit(10000);
    },
    filter: boolFilter(
      ...rangeQuery(start, end),
      ...environmentQuery(environment),
      ...kqlQuery(kuery),
      // `must_not` also keeps the documents that have no `error.type`.
      { bool: { must_not: { term: { 'error.type': 'crash' } } } }
    ),
  });

  if (!response) {
    return { buckets: [] };
  }

  const docCountByBucket = new Map(
    esqlRows(response).map((row) => [Number(row.bucket), Number(row.doc_count)])
  );

  const buckets = getHistogramKeys({ start, end, intervalInMs: bucketSize }).map((key) => ({
    x: key,
    y: docCountByBucket.get(key) ?? 0,
  }));
  return { buckets };
}
