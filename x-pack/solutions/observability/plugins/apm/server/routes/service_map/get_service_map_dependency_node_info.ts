/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql, type ComposerQuery } from '@elastic/esql';
import { sumBy } from 'lodash';
import type { ServiceMapServiceDependencyInfoResponse } from '@kbn/apm-api-shared';
import { calculateThroughputWithRange } from '@kbn/apm-data-access-plugin/server/utils';
import type { NodeStats } from '@kbn/apm-types';
import { LatencyAggregationType } from '@kbn/apm-types';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { rangeQuery } from '@kbn/observability-plugin/server';
import { calculateThroughputWithInterval } from '../../lib/helpers/calculate_throughput';
import {
  EVENT_OUTCOME,
  SERVICE_NAME,
  SPAN_DESTINATION_SERVICE_RESOURCE,
  SPAN_DESTINATION_SERVICE_RESPONSE_TIME_COUNT,
  SPAN_DESTINATION_SERVICE_RESPONSE_TIME_SUM,
  SPAN_DURATION,
} from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import { getBucketSize } from '../../../common/utils/get_bucket_size';
import { getOffsetInMs } from '../../../common/utils/get_offset_in_ms';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { getDocumentTypeFilterForServiceDestinationStatistics } from '../../lib/helpers/spans/get_is_using_service_destination_metrics';
import { esqlRows } from '../../lib/helpers/esql_read';
import { addTimeBucket, getTimeBucketKeys } from '../../lib/helpers/esql_values';
import { nullifyEmptyRedMetricPoints } from '../../../common/utils/red_metric_value_for_histogram_bucket';
import { withApmSpan } from '../../utils/with_apm_span';

interface Options {
  apmEventClient: APMEventClient;
  environment: string;
  dependencies: string[];
  sourceServiceName?: string;
  start: number;
  end: number;
  offset?: string;
  latencyAggregationType?: LatencyAggregationType;
}

function getServiceMapDependencyNodeInfoForTimeRange({
  environment,
  dependencies,
  sourceServiceName,
  apmEventClient,
  start,
  end,
  offset,
  latencyAggregationType = LatencyAggregationType.avg,
}: Options): Promise<NodeStats> {
  return withApmSpan('get_service_map_dependency_node_stats', async () => {
    const { offsetInMs, startWithOffset, endWithOffset } = getOffsetInMs({
      start,
      end,
      offset,
    });

    const { bucketSize } = getBucketSize({
      start: startWithOffset,
      end: endWithOffset,
      numBuckets: 20,
    });

    const intervalMs = bucketSize * 1000;
    const bucketKeys = getTimeBucketKeys({
      start: startWithOffset,
      end: endWithOffset,
      intervalMs,
    });

    const connectionFilter = {
      bool: {
        filter: [...rangeQuery(startWithOffset, endWithOffset), ...environmentQuery(environment)],
      },
    };

    const withConnection = (query: ComposerQuery) => {
      const withDependencies = query.pipe`WHERE ${esql.col(
        SPAN_DESTINATION_SERVICE_RESOURCE
      )} IN (${{ dependencies }})`;
      return sourceServiceName
        ? withDependencies.pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ sourceServiceName }}`
        : withDependencies;
    };

    // Rollup search: always used for throughput + failed transaction rate.
    // Also used for avg latency. The totals are the sums of the buckets.
    const rollupSearch = apmEventClient.esql('get_service_map_dependency_node_stats', {
      apm: {
        events: [ProcessorEvent.metric],
      },
      query: (index) =>
        addTimeBucket(withConnection(esql.from(index)), intervalMs).pipe`STATS
            doc_count = COUNT(*),
            latency_sum = SUM(${esql.col(SPAN_DESTINATION_SERVICE_RESPONSE_TIME_SUM)}),
            count = SUM(${esql.col(SPAN_DESTINATION_SERVICE_RESPONSE_TIME_COUNT)}),
            successful_or_failed = COUNT(*) WHERE ${esql.col(EVENT_OUTCOME)} IN (${{
          outcomes: ['failure', 'success'],
        }}),
            successful = COUNT(*) WHERE ${esql.col(EVENT_OUTCOME)} == ${{ success: 'success' }}
          BY bucket`.limit(bucketKeys.length),
      filter: {
        bool: {
          filter: [
            ...getDocumentTypeFilterForServiceDestinationStatistics(true),
            ...connectionFilter.bool.filter,
          ],
        },
      },
    });

    const isPercentile =
      latencyAggregationType === LatencyAggregationType.p95 ||
      latencyAggregationType === LatencyAggregationType.p99;
    const percentile = latencyAggregationType === LatencyAggregationType.p95 ? 95 : 99;

    // p95/p99 latency needs the raw span documents: percentiles cannot be computed from the
    // pre-aggregated rollup, so both requests run in parallel. A percentile cannot be summed
    // over buckets, so the overall value is its own request.
    const percentileSearch = (bucketed: boolean) =>
      apmEventClient.esql(
        bucketed
          ? 'get_service_map_dependency_node_stats_percentile_timeseries'
          : 'get_service_map_dependency_node_stats_percentile',
        {
          apm: {
            events: [ProcessorEvent.span],
          },
          query: (index) => {
            const spans = withConnection(esql.from(index));
            return bucketed
              ? addTimeBucket(spans, intervalMs).pipe`STATS latency = PERCENTILE(${esql.col(
                  SPAN_DURATION
                )}, ${{ percentile }}) BY bucket`.limit(bucketKeys.length)
              : spans.pipe`STATS latency = PERCENTILE(${esql.col(SPAN_DURATION)}, ${{
                  percentile,
                }})`.limit(1);
          },
          filter: connectionFilter,
        }
      );

    const [rollupResponse, spanTimeseriesResponse, spanResponse] = await Promise.all([
      rollupSearch,
      isPercentile ? percentileSearch(true) : undefined,
      isPercentile ? percentileSearch(false) : undefined,
    ]);

    const rollupBuckets = new Map(
      esqlRows(rollupResponse).map((row) => [row.bucket as number, row])
    );
    const buckets = bucketKeys.map((key) => {
      const row = rollupBuckets.get(key);
      return {
        key,
        docCount: Number(row?.doc_count ?? 0),
        latencySum: row?.latency_sum == null ? null : Number(row.latency_sum),
        count: row?.count == null ? null : Number(row.count),
        successfulOrFailed: Number(row?.successful_or_failed ?? 0),
        successful: Number(row?.successful ?? 0),
      };
    });

    const count = sumBy(buckets, (bucket) => bucket.count ?? 0);
    const latencySum = sumBy(buckets, (bucket) => bucket.latencySum ?? 0);
    const successfulOrFailed = sumBy(buckets, (bucket) => bucket.successfulOrFailed);
    const successful = sumBy(buckets, (bucket) => bucket.successful);

    const avgFailedTransactionsRate = (successfulOrFailed - successful) / successfulOrFailed;

    const throughput = calculateThroughputWithRange({
      start: startWithOffset,
      end: endWithOffset,
      value: count,
    });

    if (count === 0) {
      return {
        failedTransactionsRate: undefined,
        transactionStats: {
          throughput: undefined,
          latency: undefined,
        },
      };
    }

    // p95/p99 latency needs the raw span documents: percentiles cannot be computed from the
    // pre-aggregated response_time.sum.us rollup. The average comes from the rollup, so the
    // numbers of the different aggregation types do not come from the same data source.
    let latencyValue: number | null = latencySum / count;
    let latencyTimeseries: Array<{ x: number; y: number | null }> | undefined = buckets.map(
      (bucket) => ({
        x: bucket.key + offsetInMs,
        y: bucket.count && bucket.latencySum != null ? bucket.latencySum / bucket.count : null,
      })
    );

    if (isPercentile) {
      const overall = esqlRows(spanResponse)[0]?.latency;
      latencyValue = overall == null ? null : Number(overall);

      const spanBuckets = new Map(
        esqlRows(spanTimeseriesResponse).map((row) => [row.bucket as number, row.latency])
      );
      latencyTimeseries = bucketKeys.map((key) => {
        const value = spanBuckets.get(key);
        return { x: key + offsetInMs, y: value == null ? null : Number(value) };
      });
    }

    return {
      failedTransactionsRate: {
        value: avgFailedTransactionsRate,
        timeseries: nullifyEmptyRedMetricPoints(
          buckets.map((bucket) => ({
            x: bucket.key + offsetInMs,
            docCount: bucket.docCount,
            y: (bucket.successfulOrFailed - bucket.successful) / bucket.successfulOrFailed,
          }))
        ),
      },
      transactionStats: {
        throughput: {
          value: throughput,
          timeseries: buckets.map((bucket) => {
            return {
              x: bucket.key + offsetInMs,
              // The summed span count of the bucket (not the number of metric documents),
              // normalized by the bucket interval, not by the whole range.
              y: calculateThroughputWithInterval({
                bucketSize,
                value: bucket.count ?? 0,
              }),
            };
          }),
        },
        latency: {
          value: latencyValue,
          timeseries: latencyTimeseries,
        },
      },
    };
  });
}

export async function getServiceMapDependencyNodeInfo({
  apmEventClient,
  dependencies,
  sourceServiceName,
  start,
  end,
  environment,
  offset,
  latencyAggregationType,
}: Options): Promise<ServiceMapServiceDependencyInfoResponse> {
  const commonProps = {
    environment,
    apmEventClient,
    dependencies,
    sourceServiceName,
    start,
    end,
    latencyAggregationType,
  };

  const [currentPeriod, previousPeriod] = await Promise.all([
    getServiceMapDependencyNodeInfoForTimeRange(commonProps),
    offset ? getServiceMapDependencyNodeInfoForTimeRange({ ...commonProps, offset }) : undefined,
  ]);

  return { currentPeriod, previousPeriod };
}
