/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import type { Coordinate } from '@kbn/apm-types';
import type { Maybe } from '@kbn/apm-types-shared';
import {
  SERVICE_NAME,
  TRANSACTION_NAME,
  SPAN_TYPE,
  SPAN_SUBTYPE,
} from '../../../common/es_fields/apm';
import { MobileSpanSubtype, MobileSpanType } from '../../../common/mobile/constants';
import { environmentQuery } from '../../../common/utils/environment_query';
import { esqlRows } from '../../lib/helpers/esql_read';
import {
  addTimeBucket,
  esqlBucketMap,
  getTimeBucketKeys,
  toNumberOrNull,
  whereTerm,
} from '../../lib/helpers/esql_values';
import { getBucketSize } from '../../../common/utils/get_bucket_size';
import { getOffsetInMs } from '../../../common/utils/get_offset_in_ms';
import { offsetPreviousPeriodCoordinates } from '../../../common/utils/offset_previous_period_coordinate';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';

export interface HttpRequestsTimeseries {
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

async function getHttpRequestsTimeseries({
  kuery,
  apmEventClient,
  serviceName,
  transactionName,
  environment,
  start,
  end,
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
    apm: { events: [ProcessorEvent.span, ProcessorEvent.transaction] },
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
  // `span.subtype`, `span.type` and the transaction name are not mapped in every index, so
  // unmapped fields read as null.
  const scoped = (index: string[]) =>
    whereTerm(
      whereTerm(
        whereTerm(
          esql.from(index).addSetCommand('unmapped_fields', 'nullify'),
          SPAN_TYPE,
          MobileSpanType.External
        ),
        SERVICE_NAME,
        serviceName
      ),
      TRANSACTION_NAME,
      transactionName
    );
  const [timeseriesResponse, totalResponse] = await Promise.all([
    apmEventClient.esql('get_http_requests_chart', {
      ...request,
      query: (index) =>
        addTimeBucket(scoped(index), intervalMs).pipe`STATS requests = COUNT(*) WHERE ${esql.col(
          SPAN_SUBTYPE
        )} == ${{ spanSubtype: MobileSpanSubtype.Http }} BY bucket`.limit(bucketKeys.length),
    }),
    apmEventClient.esql('get_http_requests_chart_total', {
      ...request,
      query: (index) =>
        scoped(index).pipe`STATS requests = COUNT(*) WHERE ${esql.col(SPAN_SUBTYPE)} == ${{
          spanSubtype: MobileSpanSubtype.Http,
        }}`.limit(1),
    }),
  ]);

  const buckets = esqlBucketMap(timeseriesResponse);
  const timeseries = bucketKeys.map((key) => ({
    x: key,
    y: Number(buckets.get(key)?.requests ?? 0),
  }));

  return {
    timeseries,
    value: toNumberOrNull(esqlRows(totalResponse)[0]?.requests),
  };
}

export async function getMobileHttpRequests({
  kuery,
  apmEventClient,
  serviceName,
  transactionName,
  environment,
  start,
  end,
  offset,
}: Props): Promise<HttpRequestsTimeseries> {
  const options = {
    serviceName,
    transactionName,
    apmEventClient,
    kuery,
    environment,
  };

  const currentPeriodPromise = getHttpRequestsTimeseries({
    ...options,
    start,
    end,
  });

  const previousPeriodPromise = offset
    ? getHttpRequestsTimeseries({
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
