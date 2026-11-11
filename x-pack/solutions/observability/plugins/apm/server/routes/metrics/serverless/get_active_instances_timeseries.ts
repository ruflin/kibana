/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import {
  FAAS_ID,
  METRICSET_NAME,
  SERVICE_NAME,
  SERVICE_NODE_NAME,
} from '../../../../common/es_fields/apm';
import { environmentQuery } from '../../../../common/utils/environment_query';
import type { Coordinate } from '../../../../typings/timeseries';
import { getMetricsBucketSizeInSeconds } from '../../../lib/helpers/metrics';
import { esqlRows } from '../../../lib/helpers/esql_read';
import { boolFilter, fromApmIndex, getHistogramKeys } from '../../../lib/helpers/esql_apm';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';
import type { APMConfig } from '../../..';

export async function getActiveInstancesTimeseries({
  environment,
  kuery,
  serviceName,
  start,
  end,
  serverlessId,
  config,
  apmEventClient,
}: {
  environment: string;
  kuery: string;
  serviceName: string;
  start: number;
  end: number;
  serverlessId?: string;
  config: APMConfig;
  apmEventClient: APMEventClient;
}): Promise<Coordinate[]> {
  const intervalInMs =
    getMetricsBucketSizeInSeconds({ start, end, metricsInterval: config.metricsInterval }) * 1000;

  const response = await apmEventClient.esql('get_active_instances', {
    apm: {
      events: [ProcessorEvent.metric],
    },
    query: (index) => {
      let query = fromApmIndex(index).pipe`WHERE ${esql.col(METRICSET_NAME)} == ${{
        metricset: 'app',
      }}`.pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ serviceName }}`;
      if (serverlessId) {
        query = query.pipe`WHERE ${esql.col(FAAS_ID)} == ${{ serverlessId }}`;
      }
      return query.pipe`STATS active_instances = COUNT_DISTINCT(${esql.col(
        SERVICE_NODE_NAME
      )}) BY bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ${{ intervalInMs }}`
        .pipe`SORT bucket ASC`.limit(10000);
    },
    filter: boolFilter(
      ...rangeQuery(start, end),
      ...environmentQuery(environment),
      ...kqlQuery(kuery)
    ),
  });

  if (!response) {
    return [];
  }

  const activeInstancesByBucket = new Map(
    esqlRows(response).map((row) => [Number(row.bucket), Number(row.active_instances)])
  );

  // A bucket without documents has no instances, like in a histogram aggregation.
  return getHistogramKeys({ start, end, intervalInMs }).map((key) => ({
    x: key,
    y: activeInstancesByBucket.get(key) ?? 0,
  }));
}
