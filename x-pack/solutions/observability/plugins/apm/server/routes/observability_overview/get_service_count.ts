/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { rangeQuery } from '@kbn/observability-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { SERVICE_NAME } from '../../../common/es_fields/apm';
import { getProcessorEventForTransactions } from '../../lib/helpers/transactions';
import { esqlRows } from '../../lib/helpers/esql_read';
import { boolFilter, fromApmIndex } from '../../lib/helpers/esql_apm';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';

export async function getServiceCount({
  apmEventClient,
  searchAggregatedTransactions,
  start,
  end,
}: {
  apmEventClient: APMEventClient;
  searchAggregatedTransactions: boolean;
  start: number;
  end: number;
}) {
  const response = await apmEventClient.esql('observability_overview_get_service_count', {
    apm: {
      events: [
        getProcessorEventForTransactions(searchAggregatedTransactions),
        ProcessorEvent.error,
        ProcessorEvent.metric,
      ],
    },
    query: (index) =>
      fromApmIndex(index).pipe`STATS service_count = COUNT_DISTINCT(${esql.col(
        SERVICE_NAME
      )})`.limit(1),
    filter: boolFilter(...rangeQuery(start, end)),
  });

  return Number(esqlRows(response)[0]?.service_count ?? 0);
}
