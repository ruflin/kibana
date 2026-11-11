/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import type {
  AwsLambdaArchitecture,
  AWSLambdaPriceFactor,
  ServerlessSummaryResponse,
} from '@kbn/apm-api-shared';
import { ApmDocumentType } from '../../../../common/document_type';
import {
  FAAS_BILLED_DURATION,
  FAAS_DURATION,
  FAAS_ID,
  HOST_ARCHITECTURE,
  METRICSET_NAME,
  METRIC_SYSTEM_FREE_MEMORY,
  METRIC_SYSTEM_TOTAL_MEMORY,
  SERVICE_NAME,
} from '../../../../common/es_fields/apm';
import { RollupInterval } from '../../../../common/rollup';
import { environmentQuery } from '../../../../common/utils/environment_query';
import { esqlRows } from '../../../lib/helpers/esql_read';
import { boolFilter, fromApmIndex } from '../../../lib/helpers/esql_apm';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';
import { calcEstimatedCost, calcMemoryUsedRate, convertComputeUsageToGbSec } from './helper';

async function getServerlessTransactionThroughput({
  end,
  environment,
  kuery,
  serviceName,
  start,
  serverlessId,
  apmEventClient,
}: {
  environment: string;
  kuery: string;
  serviceName: string;
  start: number;
  end: number;
  serverlessId?: string;
  apmEventClient: APMEventClient;
}) {
  const response = await apmEventClient.esql('get_serverless_transaction_throughout', {
    apm: {
      sources: [
        {
          documentType: ApmDocumentType.TransactionEvent,
          rollupInterval: RollupInterval.None,
        },
      ],
    },
    query: (index) => {
      let query = fromApmIndex(index).pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ serviceName }}`;
      if (serverlessId) {
        query = query.pipe`WHERE ${esql.col(FAAS_ID)} == ${{ serverlessId }}`;
      }
      return query.pipe`STATS transaction_count = COUNT(*)`.limit(1);
    },
    filter: boolFilter(
      ...rangeQuery(start, end),
      ...environmentQuery(environment),
      ...kqlQuery(kuery)
    ),
  });

  return Number(esqlRows(response)[0]?.transaction_count ?? 0);
}

export async function getServerlessSummary({
  end,
  environment,
  kuery,
  serviceName,
  start,
  serverlessId,
  apmEventClient,
  awsLambdaPriceFactor,
  awsLambdaRequestCostPerMillion,
}: {
  environment: string;
  kuery: string;
  serviceName: string;
  start: number;
  end: number;
  serverlessId?: string;
  apmEventClient: APMEventClient;
  awsLambdaPriceFactor?: AWSLambdaPriceFactor;
  awsLambdaRequestCostPerMillion?: number;
}): Promise<ServerlessSummaryResponse> {
  const [response, transactionThroughput] = await Promise.all([
    apmEventClient.esql('get_serverless_summary', {
      apm: {
        events: [ProcessorEvent.metric],
      },
      // The compute usage is the average of the memory times the billed duration, where a
      // missing value counts as 0.
      query: (index) => {
        let query = fromApmIndex(index).pipe`WHERE ${esql.col(METRICSET_NAME)} == ${{
          metricset: 'app',
        }}`.pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ serviceName }}`;
        if (serverlessId) {
          query = query.pipe`WHERE ${esql.col(FAAS_ID)} == ${{ serverlessId }}`;
        }
        return query.pipe`STATS total_functions = COUNT_DISTINCT(${esql.col(FAAS_ID)}),
            faas_duration_avg = AVG(${esql.col(FAAS_DURATION)}),
            faas_billed_duration_avg = AVG(${esql.col(FAAS_BILLED_DURATION)}),
            avg_total_memory = AVG(${esql.col(METRIC_SYSTEM_TOTAL_MEMORY)}),
            avg_free_memory = AVG(${esql.col(METRIC_SYSTEM_FREE_MEMORY)}),
            count_invocations = COUNT(${esql.col(FAAS_BILLED_DURATION)}),
            avg_compute_usage_bytes_ms = AVG(TO_DOUBLE(COALESCE(${esql.col(
              METRIC_SYSTEM_TOTAL_MEMORY
            )}, 0)) * COALESCE(${esql.col(FAAS_BILLED_DURATION)}, 0)),
            architecture = LAST(${esql.col(HOST_ARCHITECTURE)}, @timestamp)`.limit(1);
      },
      filter: boolFilter(
        ...rangeQuery(start, end),
        ...environmentQuery(environment),
        ...kqlQuery(kuery)
      ),
    }),
    getServerlessTransactionThroughput({
      end,
      environment,
      kuery,
      serviceName,
      apmEventClient,
      start,
      serverlessId,
    }),
  ]);

  const summary = esqlRows(response)[0];
  const numberOrNull = (value: unknown) => (typeof value === 'number' ? value : null);

  return {
    memoryUsageAvgRate: calcMemoryUsedRate({
      memoryFree: numberOrNull(summary?.avg_free_memory),
      memoryTotal: numberOrNull(summary?.avg_total_memory),
    }),
    serverlessFunctionsTotal: numberOrNull(summary?.total_functions) ?? undefined,
    serverlessDurationAvg: numberOrNull(summary?.faas_duration_avg),
    billedDurationAvg: numberOrNull(summary?.faas_billed_duration_avg),
    estimatedCost: calcEstimatedCost({
      awsLambdaPriceFactor,
      awsLambdaRequestCostPerMillion,
      architecture:
        (summary?.architecture as AwsLambdaArchitecture | null | undefined) ?? undefined,
      transactionThroughput,
      computeUsageGbSec: convertComputeUsageToGbSec({
        computeUsageBytesMs: numberOrNull(summary?.avg_compute_usage_bytes_ms),
        countInvocations: numberOrNull(summary?.count_invocations),
      }),
    }),
  };
}
