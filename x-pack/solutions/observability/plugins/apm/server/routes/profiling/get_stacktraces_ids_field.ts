/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { rangeQuery, kqlQuery } from '@kbn/observability-plugin/server';
import {
  ELASTIC_PROFILER_STACK_TRACE_IDS,
  SERVICE_NAME,
  TRANSACTION_NAME,
  TRANSACTION_PROFILER_STACK_TRACE_IDS,
  TRANSACTION_TYPE,
} from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { boolFilter, hasEsqlDocuments } from '../../lib/helpers/esql_apm';

export async function getStacktracesIdsField({
  apmEventClient,
  start,
  end,
  environment,
  serviceName,
  transactionType,
  transactionName,
  kuery,
}: {
  apmEventClient: APMEventClient;
  start: number;
  end: number;
  environment: string;
  serviceName: string;
  transactionType: string;
  transactionName?: string;
  kuery?: string;
}) {
  // A transaction that carries the Elastic profiler field decides; the `should` of the Query DSL
  // only ranked such transactions first, so this asks for one of them directly.
  const hasElasticField = await hasEsqlDocuments({
    apmEventClient,
    operationName: 'get_stacktraces_ids_field',
    apm: {
      events: [ProcessorEvent.transaction],
    },
    equals: [
      [SERVICE_NAME, serviceName],
      [TRANSACTION_TYPE, transactionType],
      ...(transactionName
        ? ([[TRANSACTION_NAME, transactionName]] as Array<[string, string]>)
        : []),
    ],
    anyOfFields: [ELASTIC_PROFILER_STACK_TRACE_IDS],
    filter: boolFilter(
      ...rangeQuery(start, end),
      ...kqlQuery(kuery),
      ...environmentQuery(environment)
    ),
  });

  return hasElasticField ? ELASTIC_PROFILER_STACK_TRACE_IDS : TRANSACTION_PROFILER_STACK_TRACE_IDS;
}
