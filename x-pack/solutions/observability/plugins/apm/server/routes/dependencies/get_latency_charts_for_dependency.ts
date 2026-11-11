/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import type { LatencyChartsDependencyResponse } from '@kbn/apm-api-shared';
import { SPAN_DESTINATION_SERVICE_RESOURCE, SPAN_NAME } from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import { getMetricsBucketSizeInSeconds } from '../../lib/helpers/metrics';
import { esqlRows } from '../../lib/helpers/esql_read';
import { boolFilter, fromApmIndex, getHistogramKeys } from '../../lib/helpers/esql_apm';
import { getOffsetInMs } from '../../../common/utils/get_offset_in_ms';
import {
  getDocCountFieldForServiceDestinationStatistics,
  getDocumentTypeFilterForServiceDestinationStatistics,
  getLatencyFieldForServiceDestinationStatistics,
  getProcessorEventForServiceDestinationStatistics,
} from '../../lib/helpers/spans/get_is_using_service_destination_metrics';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';

interface Options {
  dependencyName: string;
  spanName: string;
  searchServiceDestinationMetrics: boolean;
  apmEventClient: APMEventClient;
  start: number;
  end: number;
  environment: string;
  kuery: string;
  offset?: string;
}

async function getLatencyChartsForDependencyForTimeRange({
  dependencyName,
  spanName,
  searchServiceDestinationMetrics,
  apmEventClient,
  start,
  end,
  environment,
  kuery,
  offset,
}: Options) {
  const { offsetInMs, startWithOffset, endWithOffset } = getOffsetInMs({
    start,
    end,
    offset,
  });

  const intervalInMs =
    getMetricsBucketSizeInSeconds({
      start: startWithOffset,
      end: endWithOffset,
      metricsInterval: 60,
    }) * 1000;
  const latencyField = getLatencyFieldForServiceDestinationStatistics(
    searchServiceDestinationMetrics
  );
  const docCountField = getDocCountFieldForServiceDestinationStatistics(
    searchServiceDestinationMetrics
  );

  const response = await apmEventClient.esql('get_latency_for_dependency', {
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
      const latencyCount = docCountField
        ? esql.exp`SUM(${esql.col(docCountField)})`
        : esql.exp`COUNT(*)`;
      return query.pipe`STATS latency_sum = SUM(${esql.col(
        latencyField
      )}), latency_count = ${latencyCount} BY bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ${{
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

  const rowsByBucket = new Map(esqlRows(response).map((row) => [Number(row.bucket), row]));

  // A bucket without documents has a sum of 0 and a count of 0, like in a histogram aggregation.
  return getHistogramKeys({ start: startWithOffset, end: endWithOffset, intervalInMs }).map(
    (key) => {
      const row = rowsByBucket.get(key);
      return {
        x: key + offsetInMs,
        y: Number(row?.latency_sum ?? 0) / Number(row?.latency_count ?? 0),
      };
    }
  );
}

export async function getLatencyChartsForDependency({
  apmEventClient,
  dependencyName,
  start,
  end,
  environment,
  kuery,
  searchServiceDestinationMetrics,
  spanName,
  offset,
}: Options): Promise<LatencyChartsDependencyResponse> {
  const [currentTimeseries, comparisonTimeseries] = await Promise.all([
    getLatencyChartsForDependencyForTimeRange({
      dependencyName,
      spanName,
      searchServiceDestinationMetrics,
      apmEventClient,
      start,
      end,
      kuery,
      environment,
    }),
    offset
      ? getLatencyChartsForDependencyForTimeRange({
          dependencyName,
          spanName,
          searchServiceDestinationMetrics,
          apmEventClient,
          start,
          end,
          kuery,
          environment,
          offset,
        })
      : null,
  ]);

  return { currentTimeseries, comparisonTimeseries };
}
