/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import type { Coordinate } from '@kbn/apm-types';
import type { Maybe } from '@kbn/apm-types-shared';
import { offsetPreviousPeriodCoordinates } from '../../../common/utils/offset_previous_period_coordinate';
import { SERVICE_NAME, SESSION_ID, TRANSACTION_NAME } from '../../../common/es_fields/apm';
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
import { ApmDocumentType } from '../../../common/document_type';
import { RollupInterval } from '../../../common/rollup';

export interface SessionsTimeseries {
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

async function getSessionTimeseries({
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
          documentType: ApmDocumentType.TransactionEvent,
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
  const scoped = (index: string[]) =>
    whereTerm(
      whereTerm(esql.from(index), SERVICE_NAME, serviceName),
      TRANSACTION_NAME,
      transactionName
    ).pipe`WHERE ${esql.col(SESSION_ID)} IS NOT NULL`;

  const [timeseriesResponse, totalResponse] = await Promise.all([
    apmEventClient.esql('get_mobile_sessions', {
      ...request,
      query: (index) =>
        addTimeBucket(scoped(index), intervalMs).pipe`STATS sessions = COUNT_DISTINCT(${esql.col(
          SESSION_ID
        )}) BY bucket`.limit(bucketKeys.length),
    }),
    apmEventClient.esql('get_mobile_sessions_total', {
      ...request,
      query: (index) =>
        scoped(index).pipe`STATS sessions = COUNT_DISTINCT(${esql.col(SESSION_ID)})`.limit(1),
    }),
  ]);

  const buckets = esqlBucketMap(timeseriesResponse);
  const timeseries = bucketKeys.map((key) => ({
    x: key,
    y: Number(buckets.get(key)?.sessions ?? 0),
  }));

  return {
    timeseries,
    value: toNumberOrNull(esqlRows(totalResponse)[0]?.sessions),
  };
}

export async function getMobileSessions({
  kuery,
  apmEventClient,
  serviceName,
  transactionName,
  environment,
  start,
  end,
  offset,
}: Props): Promise<SessionsTimeseries> {
  const options = {
    serviceName,
    transactionName,
    apmEventClient,
    kuery,
    environment,
  };

  const currentPeriodPromise = getSessionTimeseries({
    ...options,
    start,
    end,
  });

  const previousPeriodPromise = offset
    ? getSessionTimeseries({
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
