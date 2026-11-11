/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import type { ThroughputChartsForDependencyResponse } from '@kbn/apm-api-shared';
import { SPAN_DESTINATION_SERVICE_RESOURCE, SPAN_NAME } from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import { getOffsetInMs } from '../../../common/utils/get_offset_in_ms';
import { getBucketSize } from '../../../common/utils/get_bucket_size';
import { esqlRows } from '../../lib/helpers/esql_read';
import { boolFilter, fromApmIndex, getHistogramKeys } from '../../lib/helpers/esql_apm';
import {
  getDocCountFieldForServiceDestinationStatistics,
  getDocumentTypeFilterForServiceDestinationStatistics,
  getProcessorEventForServiceDestinationStatistics,
} from '../../lib/helpers/spans/get_is_using_service_destination_metrics';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';

interface Options {
  dependencyName: string;
  spanName: string;
  apmEventClient: APMEventClient;
  start: number;
  end: number;
  environment: string;
  kuery: string;
  searchServiceDestinationMetrics: boolean;
  offset?: string;
}

async function getThroughputChartsForDependencyForTimeRange({
  dependencyName,
  spanName,
  apmEventClient,
  start,
  end,
  environment,
  kuery,
  searchServiceDestinationMetrics,
  offset,
}: Options) {
  const { offsetInMs, startWithOffset, endWithOffset } = getOffsetInMs({
    start,
    end,
    offset,
  });

  const intervalInMs =
    getBucketSize({
      start: startWithOffset,
      end: endWithOffset,
      minBucketSize: 60,
    }).bucketSize * 1000;
  const docCountField = getDocCountFieldForServiceDestinationStatistics(
    searchServiceDestinationMetrics
  );

  const response = await apmEventClient.esql('get_throughput_for_dependency', {
    apm: {
      events: [getProcessorEventForServiceDestinationStatistics(searchServiceDestinationMetrics)],
    },
    query: (index) => {
      let query = fromApmIndex(index).pipe`WHERE ${esql.col(
        SPAN_DESTINATION_SERVICE_RESOURCE
      )} == ${{ dependencyName }}`;
      if (spanName) {
        query = query.pipe`WHERE ${esql.col(SPAN_NAME)} == ${{ spanName }}`;
      }
      // The documents of a metric are counted by their count field.
      const count = docCountField ? esql.exp`SUM(${esql.col(docCountField)})` : esql.exp`COUNT(*)`;
      return query.pipe`STATS total_count = ${count} BY bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ${{
        intervalInMs,
      }}`.pipe`SORT bucket ASC`.limit(10000);
    },
    filter: boolFilter(
      ...environmentQuery(environment),
      ...kqlQuery(kuery),
      ...rangeQuery(startWithOffset, endWithOffset),
      ...getDocumentTypeFilterForServiceDestinationStatistics(searchServiceDestinationMetrics)
    ),
  });

  if (!response) {
    return [];
  }

  const countByBucket = new Map(
    esqlRows(response).map((row) => [Number(row.bucket), Number(row.total_count ?? 0)])
  );
  const intervalInMinutes = intervalInMs / 60_000;

  // The rate per minute of a bucket: its count over the minutes of the interval. The Query DSL
  // `rate` aggregation is not available in ES|QL for data that is not a time series.
  return getHistogramKeys({ start: startWithOffset, end: endWithOffset, intervalInMs }).map(
    (key) => ({
      x: key + offsetInMs,
      y: (countByBucket.get(key) ?? 0) / intervalInMinutes,
    })
  );
}

export async function getThroughputChartsForDependency({
  dependencyName,
  spanName,
  apmEventClient,
  start,
  end,
  environment,
  kuery,
  searchServiceDestinationMetrics,
  offset,
}: Options): Promise<ThroughputChartsForDependencyResponse> {
  const [currentTimeseries, comparisonTimeseries] = await Promise.all([
    getThroughputChartsForDependencyForTimeRange({
      dependencyName,
      spanName,
      apmEventClient,
      start,
      end,
      kuery,
      environment,
      searchServiceDestinationMetrics,
    }),
    offset
      ? getThroughputChartsForDependencyForTimeRange({
          dependencyName,
          spanName,
          apmEventClient,
          start,
          end,
          kuery,
          environment,
          offset,
          searchServiceDestinationMetrics,
        })
      : null,
  ]);

  return { currentTimeseries, comparisonTimeseries };
}
