/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { APMEventClient } from '@kbn/apm-data-access-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { esql } from '@elastic/esql';
import { rangeQuery } from '@kbn/observability-plugin/server';
import { PROCESSOR_EVENT, SERVICE_NAME, TRACE_ID } from '../../../common/es_fields/apm';
import { esqlRows } from '../../lib/helpers/esql_read';
import { whereTerm } from '../../lib/helpers/esql_values';

export async function getTraceSummaryCount({
  apmEventClient,
  start,
  end,
  traceId,
}: {
  apmEventClient: APMEventClient;
  start: number;
  end: number;
  traceId: string;
}) {
  const response = await apmEventClient.esql('observability_overview_get_service_count', {
    apm: {
      events: [ProcessorEvent.span, ProcessorEvent.transaction],
    },
    // OTel-native documents may have no `processor.event`, which can be unmapped in their
    // indices, so unmapped fields read as null.
    query: (index) =>
      whereTerm(esql.from(index).addSetCommand('unmapped_fields', 'nullify'), TRACE_ID, traceId)
        .pipe`WHERE ${esql.col(PROCESSOR_EVENT)} IN (${{
        processorEvents: [ProcessorEvent.span, ProcessorEvent.transaction],
      }}) OR ${esql.col(PROCESSOR_EVENT)} IS NULL`
        .pipe`STATS trace_events = COUNT(*), services = COUNT_DISTINCT(${esql.col(
        SERVICE_NAME
      )})`.limit(1),
    filter: { bool: { filter: rangeQuery(start, end) } },
    skipProcessorEventFilter: true,
  });

  const row = esqlRows(response)[0];
  return { services: Number(row?.services ?? 0), traceEvents: Number(row?.trace_events ?? 0) };
}
