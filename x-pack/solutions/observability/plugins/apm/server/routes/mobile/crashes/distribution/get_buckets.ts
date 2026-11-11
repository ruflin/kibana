/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { rangeQuery, kqlQuery } from '@kbn/observability-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { ERROR_GROUP_ID, SERVICE_NAME, ERROR_TYPE } from '../../../../../common/es_fields/apm';
import { environmentQuery } from '../../../../../common/utils/environment_query';
import {
  addTimeBucket,
  esqlBucketMap,
  getTimeBucketKeys,
  whereTerm,
} from '../../../../lib/helpers/esql_values';
import type { APMEventClient } from '../../../../lib/helpers/create_es_client/create_apm_event_client';

export async function getBuckets({
  environment,
  kuery,
  serviceName,
  groupId,
  bucketSize,
  apmEventClient,
  start,
  end,
}: {
  environment: string;
  kuery: string;
  serviceName: string;
  groupId?: string;
  bucketSize: number;
  apmEventClient: APMEventClient;
  start: number;
  end: number;
}) {
  const bucketKeys = getTimeBucketKeys({ start, end, intervalMs: bucketSize });

  const response = await apmEventClient.esql('get_error_distribution_buckets', {
    apm: {
      events: [ProcessorEvent.error],
    },
    query: (index) =>
      addTimeBucket(
        whereTerm(
          whereTerm(whereTerm(esql.from(index), ERROR_TYPE, 'crash'), SERVICE_NAME, serviceName),
          ERROR_GROUP_ID,
          groupId
        ),
        bucketSize
      ).pipe`STATS doc_count = COUNT(*) BY bucket`.limit(bucketKeys.length),
    filter: {
      bool: {
        filter: [...rangeQuery(start, end), ...environmentQuery(environment), ...kqlQuery(kuery)],
      },
    },
  });

  const rows = esqlBucketMap(response);
  const buckets = bucketKeys.map((key) => ({
    x: key,
    y: Number(rows.get(key)?.doc_count ?? 0),
  }));
  return { buckets };
}
