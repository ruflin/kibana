/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { keyBy } from 'lodash';
import { esql } from '@elastic/esql';
import { rangeQuery, kqlQuery, termQuery } from '@kbn/observability-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import type { MobileErrorGroupPeriodsResponse } from '@kbn/apm-api-shared';
import { offsetPreviousPeriodCoordinates } from '../../../../common/utils/offset_previous_period_coordinate';
import type { Coordinate } from '../../../../typings/timeseries';
import { ERROR_GROUP_ID, ERROR_TYPE, SERVICE_NAME } from '../../../../common/es_fields/apm';
import { environmentQuery } from '../../../../common/utils/environment_query';
import { getBucketSize } from '../../../../common/utils/get_bucket_size';
import { getOffsetInMs } from '../../../../common/utils/get_offset_in_ms';
import {
  addTimeBucket,
  countByGroupAndBucket,
  esqlGroupedSeries,
  getTimeBucketKeys,
  whereIn,
  whereTerm,
} from '../../../lib/helpers/esql_values';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';

interface ErrorGroupDetailedStat {
  groupId: string;
  timeseries: Coordinate[];
}

export async function getMobileErrorGroupDetailedStatistics({
  kuery,
  serviceName,
  apmEventClient,
  numBuckets,
  groupIds,
  environment,
  start,
  end,
  offset,
}: {
  kuery: string;
  serviceName: string;
  apmEventClient: APMEventClient;
  numBuckets: number;
  groupIds: string[];
  environment: string;
  start: number;
  end: number;
  offset?: string;
}): Promise<ErrorGroupDetailedStat[]> {
  const { startWithOffset, endWithOffset } = getOffsetInMs({
    start,
    end,
    offset,
  });

  const { bucketSize } = getBucketSize({
    start: startWithOffset,
    end: endWithOffset,
    numBuckets,
  });
  const intervalMs = bucketSize * 1000;
  const bucketKeys = getTimeBucketKeys({
    start: startWithOffset,
    end: endWithOffset,
    intervalMs,
  });

  const timeseriesResponse = await apmEventClient.esql(
    'get_service_error_group_detailed_statistics',
    {
      apm: {
        events: [ProcessorEvent.error],
      },
      query: (index) =>
        countByGroupAndBucket(
          addTimeBucket(
            whereIn(
              whereTerm(esql.from(index), SERVICE_NAME, serviceName),
              ERROR_GROUP_ID,
              groupIds
            ),
            intervalMs
          ),
          ERROR_GROUP_ID,
          { groupIds, bucketCount: bucketKeys.length }
        ),
      filter: {
        bool: {
          // Documents without an error type are not crashes.
          must_not: termQuery(ERROR_TYPE, 'crash'),
          filter: [
            ...rangeQuery(startWithOffset, endWithOffset),
            ...environmentQuery(environment),
            ...kqlQuery(kuery),
          ],
        },
      },
    }
  );

  return esqlGroupedSeries(timeseriesResponse, ERROR_GROUP_ID, bucketKeys).map(
    ({ group, timeseries }) => ({
      groupId: group,
      timeseries,
    })
  );
}

export async function getMobileErrorGroupPeriods({
  kuery,
  serviceName,
  apmEventClient,
  numBuckets,
  groupIds,
  environment,
  start,
  end,
  offset,
}: {
  kuery: string;
  serviceName: string;
  apmEventClient: APMEventClient;
  numBuckets: number;
  groupIds: string[];
  environment: string;
  start: number;
  end: number;
  offset?: string;
}): Promise<MobileErrorGroupPeriodsResponse> {
  const commonProps = {
    environment,
    kuery,
    serviceName,
    apmEventClient,
    numBuckets,
    groupIds,
  };

  const currentPeriodPromise = getMobileErrorGroupDetailedStatistics({
    ...commonProps,
    start,
    end,
  });

  const previousPeriodPromise = offset
    ? getMobileErrorGroupDetailedStatistics({
        ...commonProps,
        start,
        end,
        offset,
      })
    : [];

  const [currentPeriod, previousPeriod] = await Promise.all([
    currentPeriodPromise,
    previousPeriodPromise,
  ]);

  const firstCurrentPeriod = currentPeriod?.[0];

  return {
    currentPeriod: keyBy(currentPeriod, 'groupId'),
    previousPeriod: keyBy(
      previousPeriod.map((errorRateGroup) => ({
        ...errorRateGroup,
        timeseries: offsetPreviousPeriodCoordinates({
          currentPeriodTimeseries: firstCurrentPeriod?.timeseries,
          previousPeriodTimeseries: errorRateGroup.timeseries,
        }),
      })),
      'groupId'
    ),
  };
}
