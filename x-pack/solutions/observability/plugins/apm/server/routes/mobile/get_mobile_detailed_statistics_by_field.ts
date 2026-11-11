/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import { keyBy } from 'lodash';
import type { Coordinate } from '@kbn/apm-types';
import { getBucketSize } from '../../../common/utils/get_bucket_size';
import { getOffsetInMs } from '../../../common/utils/get_offset_in_ms';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { environmentQuery } from '../../../common/utils/environment_query';
import { SERVICE_NAME, TRANSACTION_DURATION } from '../../../common/es_fields/apm';
import { esqlRows } from '../../lib/helpers/esql_read';
import {
  addTimeBucket,
  getTimeBucketKeys,
  toNumberOrNull,
  whereTerm,
} from '../../lib/helpers/esql_values';
import { offsetPreviousPeriodCoordinates } from '../../../common/utils/offset_previous_period_coordinate';
import { ApmDocumentType } from '../../../common/document_type';
import { RollupInterval } from '../../../common/rollup';

interface MobileDetailedStatistics {
  fieldName: string;
  latency: Coordinate[];
  throughput: Coordinate[];
}

export interface MobileDetailedStatisticsResponse {
  currentPeriod: Record<string, MobileDetailedStatistics>;
  previousPeriod: Record<string, MobileDetailedStatistics>;
}

interface Props {
  kuery: string;
  apmEventClient: APMEventClient;
  serviceName: string;
  environment: string;
  start: number;
  end: number;
  field: string;
  fieldValues: string[];
  offset?: string;
}

async function getMobileDetailedStatisticsByField({
  environment,
  kuery,
  serviceName,
  field,
  fieldValues,
  apmEventClient,
  start,
  end,
  offset,
}: Props) {
  const { startWithOffset, endWithOffset } = getOffsetInMs({
    start,
    end,
    offset,
  });

  if (fieldValues.length === 0) {
    return [];
  }

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

  const response = await apmEventClient.esql(`get_mobile_detailed_statistics_by_field`, {
    apm: {
      sources: [
        {
          documentType: ApmDocumentType.TransactionEvent,
          rollupInterval: RollupInterval.None,
        },
      ],
    },
    // The field is not mapped in every index, so unmapped fields read as null.
    query: (index) =>
      addTimeBucket(
        whereTerm(
          esql.from(index).addSetCommand('unmapped_fields', 'nullify'),
          SERVICE_NAME,
          serviceName
        ).pipe`WHERE ${esql.col(field)} IN (${{ fieldValues }})`,
        intervalMs
      ).pipe`STATS
          doc_count = COUNT(*),
          latency = AVG(${esql.col(TRANSACTION_DURATION)})
        BY ${esql.col(field)}, bucket`.limit(fieldValues.length * bucketKeys.length),
    filter: {
      bool: {
        filter: [
          ...rangeQuery(startWithOffset, endWithOffset),
          ...environmentQuery(environment),
          ...kqlQuery(kuery),
        ],
      },
    },
  });

  // Group the rows by field value, most documents first like a `terms` aggregation, and give
  // every group all the buckets of the range.
  const rowsByFieldValue = new Map<string, Map<number, Record<string, unknown>>>();
  const docCountByFieldValue = new Map<string, number>();
  for (const row of esqlRows(response)) {
    const fieldName = String(row[field]);
    const buckets = rowsByFieldValue.get(fieldName) ?? new Map<number, Record<string, unknown>>();
    buckets.set(Number(row.bucket), row);
    rowsByFieldValue.set(fieldName, buckets);
    docCountByFieldValue.set(
      fieldName,
      (docCountByFieldValue.get(fieldName) ?? 0) + Number(row.doc_count)
    );
  }

  return [...rowsByFieldValue.entries()]
    .sort(
      ([nameA], [nameB]) =>
        (docCountByFieldValue.get(nameB) ?? 0) - (docCountByFieldValue.get(nameA) ?? 0) ||
        nameA.localeCompare(nameB)
    )
    .map(([fieldName, buckets]) => {
      const latency = bucketKeys.map((key) => ({
        x: key,
        y: toNumberOrNull(buckets.get(key)?.latency),
      }));
      const throughput = bucketKeys.map((key) => ({
        x: key,
        y: Number(buckets.get(key)?.doc_count ?? 0),
      }));

      return {
        fieldName,
        latency,
        throughput,
      };
    });
}

export async function getMobileDetailedStatisticsByFieldPeriods({
  environment,
  kuery,
  serviceName,
  field,
  fieldValues,
  apmEventClient,
  start,
  end,
  offset,
}: Props): Promise<MobileDetailedStatisticsResponse> {
  const commonProps = {
    environment,
    kuery,
    serviceName,
    field,
    fieldValues,
    apmEventClient,
    start,
    end,
  };

  const currentPeriodPromise = getMobileDetailedStatisticsByField({
    ...commonProps,
  });

  const previousPeriodPromise = offset
    ? getMobileDetailedStatisticsByField({
        ...commonProps,
        offset,
      })
    : [];

  const [currentPeriod, previousPeriod] = await Promise.all([
    currentPeriodPromise,
    previousPeriodPromise,
  ]);

  const firstCurrentPeriod = currentPeriod?.[0];
  return {
    currentPeriod: keyBy(currentPeriod, 'fieldName'),
    previousPeriod: keyBy(
      previousPeriod.map((data) => {
        return {
          ...data,
          latency: offsetPreviousPeriodCoordinates({
            currentPeriodTimeseries: firstCurrentPeriod?.latency,
            previousPeriodTimeseries: data.latency,
          }),
          throughput: offsetPreviousPeriodCoordinates({
            currentPeriodTimeseries: firstCurrentPeriod?.throughput,
            previousPeriodTimeseries: data.throughput,
          }),
        };
      }),
      'fieldName'
    ),
  };
}
