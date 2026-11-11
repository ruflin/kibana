/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql, type ComposerQuery } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import type { Maybe } from '@kbn/apm-types-shared';
import type { Coordinate } from '../../../typings/timeseries';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlRows } from '../../lib/helpers/esql_read';
import {
  addTimeBucket,
  esqlBucketMap,
  getTimeBucketKeys,
  toNumberOrNull,
} from '../../lib/helpers/esql_values';
import { getBucketSize } from '../../../common/utils/get_bucket_size';
import { ERROR_TYPE, ERROR_ID, SERVICE_NAME } from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import { getOffsetInMs } from '../../../common/utils/get_offset_in_ms';
import { offsetPreviousPeriodCoordinates } from '../../../common/utils/offset_previous_period_coordinate';
import { ApmDocumentType } from '../../../common/document_type';
import { RollupInterval } from '../../../common/rollup';

export interface CrashRateTimeseries {
  currentPeriod: { timeseries: Coordinate[]; value: Maybe<number> };
  previousPeriod: { timeseries: Coordinate[]; value: Maybe<number> };
}

interface Props {
  apmEventClient: APMEventClient;
  serviceName: string;
  transactionName?: string;
  environment: string;
  start: number;
  end: number;
  kuery: string;
  offset?: string;
}

async function getMobileCrashTimeseries({
  apmEventClient,
  serviceName,
  transactionName,
  environment,
  start,
  end,
  kuery,
  offset,
}: Props) {
  const { startWithOffset, endWithOffset } = getOffsetInMs({
    start,
    end,
    offset,
  });

  const { bucketSize } = getBucketSize({
    start: startWithOffset,
    end: endWithOffset,
    minBucketSize: 60,
  });
  const intervalMs = bucketSize * 1000;
  const bucketKeys = getTimeBucketKeys({
    start: startWithOffset,
    end: endWithOffset,
    intervalMs,
  });

  const request = {
    apm: {
      sources: [
        {
          documentType: ApmDocumentType.ErrorEvent,
          rollupInterval: RollupInterval.None,
        },
      ],
    },
    filter: {
      bool: {
        filter: [
          ...rangeQuery(startWithOffset, endWithOffset),
          ...environmentQuery(environment),
          ...kqlQuery(kuery),
        ],
      },
    },
  };
  const crashes = (query: ComposerQuery) =>
    query.pipe`WHERE ${esql.col(ERROR_TYPE)} == ${{ errorType: 'crash' }}`.pipe`WHERE ${esql.col(
      SERVICE_NAME
    )} == ${{ serviceName }}`;

  const [timeseriesResponse, totalResponse] = await Promise.all([
    apmEventClient.esql('get_mobile_crash_rate', {
      ...request,
      query: (index) =>
        addTimeBucket(crashes(esql.from(index)), intervalMs)
          .pipe`STATS crashes = COUNT_DISTINCT(${esql.col(ERROR_ID)}) BY bucket`.limit(
          bucketKeys.length
        ),
    }),
    apmEventClient.esql('get_mobile_crash_rate_total', {
      ...request,
      query: (index) =>
        crashes(esql.from(index)).pipe`STATS crashes = COUNT_DISTINCT(${esql.col(ERROR_ID)})`.limit(
          1
        ),
    }),
  ]);

  const buckets = esqlBucketMap(timeseriesResponse);
  const timeseries = bucketKeys.map((key) => ({
    x: key,
    y: Number(buckets.get(key)?.crashes ?? 0),
  }));

  return {
    timeseries,
    value: toNumberOrNull(esqlRows(totalResponse)[0]?.crashes),
  };
}

export async function getMobileCrashRate({
  kuery,
  apmEventClient,
  serviceName,
  transactionName,
  environment,
  start,
  end,
  offset,
}: Props): Promise<CrashRateTimeseries> {
  const options = {
    serviceName,
    transactionName,
    apmEventClient,
    kuery,
    environment,
  };

  const currentPeriodPromise = getMobileCrashTimeseries({
    ...options,
    start,
    end,
  });

  const previousPeriodPromise = offset
    ? getMobileCrashTimeseries({
        ...options,
        start,
        end,
        offset,
      })
    : { timeseries: [], value: null };

  const [currentPeriod, previousPeriod] = await Promise.all([
    currentPeriodPromise,
    previousPeriodPromise,
  ]);
  return {
    currentPeriod,
    previousPeriod: {
      timeseries: offsetPreviousPeriodCoordinates({
        currentPeriodTimeseries: currentPeriod.timeseries,
        previousPeriodTimeseries: previousPeriod.timeseries,
      }),
      value: previousPeriod?.value,
    },
  };
}
