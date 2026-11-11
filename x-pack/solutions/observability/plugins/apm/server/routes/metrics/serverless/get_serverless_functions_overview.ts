/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import type { ServerlessFunctionsOverviewResponse } from '@kbn/apm-api-shared';
import {
  FAAS_BILLED_DURATION,
  FAAS_COLDSTART,
  FAAS_DURATION,
  FAAS_ID,
  METRICSET_NAME,
  METRIC_SYSTEM_FREE_MEMORY,
  METRIC_SYSTEM_TOTAL_MEMORY,
  SERVICE_NAME,
} from '../../../../common/es_fields/apm';
import { getServerlessFunctionNameFromId } from '../../../../common/serverless';
import { environmentQuery } from '../../../../common/utils/environment_query';
import { calcMemoryUsed } from './helper';
import { esqlRows } from '../../../lib/helpers/esql_read';
import { boolFilter, fromApmIndex } from '../../../lib/helpers/esql_apm';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';

export async function getServerlessFunctionsOverview({
  end,
  environment,
  kuery,
  serviceName,
  start,
  apmEventClient,
}: {
  environment: string;
  kuery: string;
  serviceName: string;
  start: number;
  end: number;
  apmEventClient: APMEventClient;
}): Promise<ServerlessFunctionsOverviewResponse> {
  const response = await apmEventClient.esql('ger_serverless_functions_overview', {
    apm: {
      events: [ProcessorEvent.metric],
    },
    // The ten functions with the most documents, like a terms aggregation. The cold starts
    // are the documents flagged as one, as a sum over the boolean field.
    query: (index) =>
      fromApmIndex(index).pipe`WHERE ${esql.col(METRICSET_NAME)} == ${{ metricset: 'app' }}`
        .pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ serviceName }}`.pipe`WHERE ${esql.col(
        FAAS_ID
      )} IS NOT NULL`.pipe`STATS doc_count = COUNT(*),
          faas_duration_avg = AVG(${esql.col(FAAS_DURATION)}),
          faas_billed_duration_avg = AVG(${esql.col(FAAS_BILLED_DURATION)}),
          cold_start_count = COUNT(*) WHERE ${esql.col(FAAS_COLDSTART)} == TRUE,
          max_total_memory = MAX(${esql.col(METRIC_SYSTEM_TOTAL_MEMORY)}),
          avg_total_memory = AVG(${esql.col(METRIC_SYSTEM_TOTAL_MEMORY)}),
          avg_free_memory = AVG(${esql.col(METRIC_SYSTEM_FREE_MEMORY)})
          BY ${esql.col(FAAS_ID)}`.pipe`SORT doc_count DESC, ${esql.col(FAAS_ID)} ASC`.limit(10),
    filter: boolFilter(
      ...rangeQuery(start, end),
      ...environmentQuery(environment),
      ...kqlQuery(kuery)
    ),
  });

  const serverlessFunctionsOverview = esqlRows(response).map((row) => {
    const serverlessId = row[FAAS_ID] as string;
    return {
      serverlessId,
      serverlessFunctionName: getServerlessFunctionNameFromId(serverlessId),
      serverlessDurationAvg: row.faas_duration_avg as number | null,
      billedDurationAvg: row.faas_billed_duration_avg as number | null,
      coldStartCount: row.cold_start_count as number,
      avgMemoryUsed: calcMemoryUsed({
        memoryFree: row.avg_free_memory as number | null,
        memoryTotal: row.avg_total_memory as number | null,
      }),
      memorySize: row.max_total_memory as number | null,
    };
  });

  return serverlessFunctionsOverview;
}
