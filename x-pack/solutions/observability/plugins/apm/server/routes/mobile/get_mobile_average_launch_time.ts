/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import type { Maybe } from '@kbn/apm-types-shared';
import { offsetPreviousPeriodCoordinates } from '../../../common/utils/offset_previous_period_coordinate';
import { APP_LAUNCH_TIME, SERVICE_NAME } from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import { getOffsetInMs } from '../../../common/utils/get_offset_in_ms';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlRows } from '../../lib/helpers/esql_read';
import {
  addTimeBucket,
  esqlBucketMap,
  getTimeBucketKeys,
  toNumberOrNull,
  whereTerm,
} from '../../lib/helpers/esql_values';
import { getBucketSize } from '../../../common/utils/get_bucket_size';
import type { Coordinate } from '../../../typings/timeseries';

export interface AvgLaunchTimeTimeseries {
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

async function getAvgLaunchTimeTimeseries({
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
    apm: { events: [ProcessorEvent.metric] },
    // The launch time field is not mapped in every metrics index, so unmapped fields read as null.
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
  const scoped = (index: string[]) =>
    whereTerm(
      esql.from(index).addSetCommand('unmapped_fields', 'nullify'),
      SERVICE_NAME,
      serviceName
    );

  const [timeseriesResponse, totalResponse] = await Promise.all([
    apmEventClient.esql('get_mobile_launch_time', {
      ...request,
      query: (index) =>
        addTimeBucket(scoped(index), intervalMs).pipe`STATS launchTimeAvg = AVG(${esql.col(
          APP_LAUNCH_TIME
        )}) BY bucket`.limit(bucketKeys.length),
    }),
    apmEventClient.esql('get_mobile_launch_time_total', {
      ...request,
      query: (index) =>
        scoped(index).pipe`STATS launchTimeAvg = AVG(${esql.col(APP_LAUNCH_TIME)})`.limit(1),
    }),
  ]);

  const buckets = esqlBucketMap(timeseriesResponse);
  const timeseries = bucketKeys.map((key) => ({
    x: key,
    y: toNumberOrNull(buckets.get(key)?.launchTimeAvg),
  }));

  return {
    timeseries,
    value: toNumberOrNull(esqlRows(totalResponse)[0]?.launchTimeAvg),
  };
}

export async function getMobileAvgLaunchTime({
  kuery,
  apmEventClient,
  serviceName,
  transactionName,
  environment,
  start,
  end,
  offset,
}: Props): Promise<AvgLaunchTimeTimeseries> {
  const options = {
    serviceName,
    transactionName,
    apmEventClient,
    kuery,
    environment,
  };

  const currentPeriodPromise = getAvgLaunchTimeTimeseries({
    ...options,
    start,
    end,
  });

  const previousPeriodPromise = offset
    ? getAvgLaunchTimeTimeseries({
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
