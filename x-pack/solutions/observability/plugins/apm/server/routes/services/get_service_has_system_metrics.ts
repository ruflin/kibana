/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { rangeQuery } from '@kbn/observability-plugin/server';
import {
  METRIC_CGROUP_MEMORY_USAGE_BYTES,
  METRIC_SYSTEM_CPU_PERCENT,
  METRIC_SYSTEM_FREE_MEMORY,
  METRIC_SYSTEM_TOTAL_MEMORY,
  SERVICE_NAME,
} from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import { esqlRows } from '../../lib/helpers/esql_read';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';

export async function getServiceHasSystemMetrics({
  apmEventClient,
  serviceName,
  environment,
  start,
  end,
}: {
  apmEventClient: APMEventClient;
  serviceName: string;
  environment: string;
  start: number;
  end: number;
}): Promise<{ hasSystemMetrics: boolean }> {
  const response = await apmEventClient.esql('get_service_has_system_metrics', {
    apm: { events: [ProcessorEvent.metric] },
    // The metric fields are not mapped in every metrics index, so unmapped fields read as null.
    query: (index) =>
      esql.from(index).addSetCommand('unmapped_fields', 'nullify').pipe`WHERE ${esql.col(
        SERVICE_NAME
      )} == ${{ serviceName }}`.pipe`WHERE ${esql.col(
        METRIC_SYSTEM_CPU_PERCENT
      )} IS NOT NULL OR ${esql.col(METRIC_CGROUP_MEMORY_USAGE_BYTES)} IS NOT NULL OR (${esql.col(
        METRIC_SYSTEM_FREE_MEMORY
      )} IS NOT NULL AND ${esql.col(METRIC_SYSTEM_TOTAL_MEMORY)} IS NOT NULL)`
        .keep(SERVICE_NAME)
        .limit(1),
    filter: {
      bool: { filter: [...rangeQuery(start, end), ...environmentQuery(environment)] },
    },
  });

  return { hasSystemMetrics: esqlRows(response).length > 0 };
}
