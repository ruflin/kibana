/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import {
  METRIC_OTEL_JVM_PROCESS_CPU_PERCENT,
  METRIC_OTEL_JVM_PROCESS_MEMORY_USAGE,
  METRIC_OTEL_JVM_PROCESS_THREADS_COUNT,
  METRIC_OTEL_SYSTEM_CPU_UTILIZATION,
  METRIC_OTEL_SYSTEM_MEMORY_UTILIZATION,
} from '../../../common/es_fields/apm';
import { SERVICE_NAME } from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import { boolFilter, hasEsqlDocuments } from '../../lib/helpers/esql_apm';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';

const hasOTelMetrics = async ({
  kuery,
  apmEventClient,
  serviceName,
  environment,
  start,
  end,
}: {
  kuery: string;
  apmEventClient: APMEventClient;
  serviceName: string;
  environment: string;
  start: number;
  end: number;
}) => {
  return hasEsqlDocuments({
    apmEventClient,
    operationName: 'has_otel_process_metrics',
    apm: {
      events: [ProcessorEvent.metric],
    },
    equals: [[SERVICE_NAME, serviceName]],
    anyOfFields: [
      METRIC_OTEL_JVM_PROCESS_CPU_PERCENT,
      METRIC_OTEL_JVM_PROCESS_MEMORY_USAGE,
      METRIC_OTEL_JVM_PROCESS_THREADS_COUNT,
      METRIC_OTEL_SYSTEM_CPU_UTILIZATION,
      METRIC_OTEL_SYSTEM_MEMORY_UTILIZATION,
    ],
    filter: boolFilter(
      ...rangeQuery(start, end),
      ...environmentQuery(environment),
      ...kqlQuery(kuery)
    ),
  });
};

export { hasOTelMetrics };
