/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getBucketSize } from '../../../common/utils/get_bucket_size';

/** The bucket size of a metrics chart: never below the configured interval, the resolution of metric data. */
export function getMetricsBucketSizeInSeconds({
  start,
  end,
  metricsInterval,
}: {
  start: number;
  end: number;
  metricsInterval: number;
}) {
  const { bucketSize } = getBucketSize({ start, end });
  return Math.max(bucketSize, metricsInterval);
}

export function getMetricsDateHistogramParams({
  start,
  end,
  metricsInterval,
}: {
  start: number;
  end: number;
  metricsInterval: number;
}) {
  return {
    field: '@timestamp',

    // ensure minimum bucket size of configured interval since this is the default resolution for metric data
    fixed_interval: `${getMetricsBucketSizeInSeconds({ start, end, metricsInterval })}s`,

    min_doc_count: 0,
    extended_bounds: { min: start, max: end },
  };
}
