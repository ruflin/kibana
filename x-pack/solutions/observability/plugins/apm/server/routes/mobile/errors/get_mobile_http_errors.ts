/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery, termQuery } from '@kbn/observability-plugin/server';
import type { MobileHttpErrorsTimeseries } from '@kbn/apm-api-shared';
import {
  addTimeBucket,
  esqlBucketMap,
  getTimeBucketKeys,
  whereTerm,
} from '../../../lib/helpers/esql_values';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';
import { getOffsetInMs } from '../../../../common/utils/get_offset_in_ms';
import { environmentQuery } from '../../../../common/utils/environment_query';
import {
  SERVICE_NAME,
  HTTP_RESPONSE_STATUS_CODE,
  ERROR_TYPE,
} from '../../../../common/es_fields/apm';
import { offsetPreviousPeriodCoordinates } from '../../../../common/utils/offset_previous_period_coordinate';
import type { Coordinate } from '../../../../typings/timeseries';
import { BUCKET_TARGET_COUNT } from '../../transactions/constants';

interface Props {
  apmEventClient: APMEventClient;
  serviceName: string;
  environment: string;
  start: number;
  end: number;
  kuery: string;
  offset?: string;
}

function getBucketSize({ start, end }: { start: number; end: number }) {
  return Math.floor((end - start) / BUCKET_TARGET_COUNT);
}

async function getMobileHttpErrorsTimeseries({
  kuery,
  apmEventClient,
  serviceName,
  environment,
  start,
  end,
}: Props) {
  const bucketSize = getBucketSize({
    start,
    end,
  });
  const bucketKeys = getTimeBucketKeys({ start, end, intervalMs: bucketSize });

  const response = await apmEventClient.esql('get_mobile_http_errors', {
    apm: { events: [ProcessorEvent.error] },
    // The status code field is not mapped in every error index, so unmapped fields read as null.
    query: (index) =>
      addTimeBucket(
        whereTerm(
          esql.from(index).addSetCommand('unmapped_fields', 'nullify'),
          SERVICE_NAME,
          serviceName
        ).pipe`WHERE ${esql.col(HTTP_RESPONSE_STATUS_CODE)} >= ${{
          minStatusCode: 400,
        }} AND ${esql.col(HTTP_RESPONSE_STATUS_CODE)} <= ${{ maxStatusCode: 599 }}`,
        bucketSize
      ).pipe`STATS doc_count = COUNT(*) BY bucket`.limit(bucketKeys.length),
    filter: {
      bool: {
        // Documents without an error type are not crashes.
        must_not: termQuery(ERROR_TYPE, 'crash'),
        filter: [...environmentQuery(environment), ...rangeQuery(start, end), ...kqlQuery(kuery)],
      },
    },
  });

  const rows = esqlBucketMap(response);
  const timeseries = bucketKeys.map((key) => ({
    x: key,
    y: Number(rows.get(key)?.doc_count ?? 0),
  }));
  return { timeseries };
}

export async function getMobileHttpErrors({
  kuery,
  apmEventClient,
  serviceName,
  environment,
  start,
  end,
  offset,
}: Props): Promise<MobileHttpErrorsTimeseries> {
  const options = {
    serviceName,
    apmEventClient,
    kuery,
    environment,
  };
  const { startWithOffset, endWithOffset } = getOffsetInMs({
    start,
    end,
    offset,
  });

  const currentPeriodPromise = getMobileHttpErrorsTimeseries({
    ...options,
    start,
    end,
  });
  const previousPeriodPromise = offset
    ? getMobileHttpErrorsTimeseries({
        ...options,
        start: startWithOffset,
        end: endWithOffset,
      })
    : { timeseries: [] as Coordinate[] };
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
    },
  };
}
