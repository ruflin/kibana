/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import { keyBy } from 'lodash';
import type { Logger } from '@kbn/core/server';
import type { DependencySpan } from '@kbn/apm-api-shared';
import { asMutableArray } from '../../../common/utils/as_mutable_array';
import {
  AGENT_NAME,
  AT_TIMESTAMP,
  EVENT_OUTCOME,
  SERVICE_NAME,
  SPAN_DESTINATION_SERVICE_RESOURCE,
  SPAN_DURATION,
  SPAN_ID,
  SPAN_NAME,
  TRACE_ID,
  TRANSACTION_ID,
  TRANSACTION_NAME,
  TRANSACTION_TYPE,
} from '../../../common/es_fields/apm';
import type { Environment } from '../../../common/environment_rt';
import { EventOutcome } from '../../../common/event_outcome';
import { environmentQuery } from '../../../common/utils/environment_query';
import { maybe } from '../../../common/utils/maybe';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlRowsAsHits, boolFilter, fromApmIndex, keepFields } from '../../lib/helpers/esql_apm';
import { compactMap } from '../../utils/compact_map';
import { createApmEventFieldsAccessor } from '../../utils/create_apm_event_fields_accessor';

const MAX_NUM_SPANS = 1000;

export async function getTopDependencySpans({
  apmEventClient,
  logger,
  dependencyName,
  spanName,
  start,
  end,
  environment,
  kuery,
  sampleRangeFrom,
  sampleRangeTo,
}: {
  apmEventClient: APMEventClient;
  logger: Logger;
  dependencyName: string;
  spanName: string;
  start: number;
  end: number;
  environment: Environment;
  kuery: string;
  sampleRangeFrom?: number;
  sampleRangeTo?: number;
}): Promise<DependencySpan[]> {
  const topDedsRequiredFields = asMutableArray([
    SPAN_ID,
    TRACE_ID,
    SPAN_NAME,
    SERVICE_NAME,
    AGENT_NAME,
    SPAN_DURATION,
    AT_TIMESTAMP,
  ] as const);
  // `event.outcome` is not guaranteed on OTel spans, so it is requested but not required.
  const topDedsFields = asMutableArray([...topDedsRequiredFields, EVENT_OUTCOME] as const);

  const spanResponse = await apmEventClient.esql('get_top_dependency_spans', {
    apm: {
      events: [ProcessorEvent.span, ProcessorEvent.transaction],
    },
    query: (index) => {
      let query = fromApmIndex(index, ['_id', '_index']).pipe`WHERE ${esql.col(
        SPAN_DESTINATION_SERVICE_RESOURCE
      )} == ${{ dependencyName }}`;
      if (spanName) {
        query = query.pipe`WHERE ${esql.col(SPAN_NAME)} == ${{ spanName }}`;
      }
      if ((sampleRangeFrom ?? 0) >= 0 && (sampleRangeTo ?? 0) > 0) {
        if (sampleRangeFrom !== undefined) {
          query = query.pipe`WHERE ${esql.col(SPAN_DURATION)} >= ${{ sampleRangeFrom }}`;
        }
        if (sampleRangeTo !== undefined) {
          query = query.pipe`WHERE ${esql.col(SPAN_DURATION)} <= ${{ sampleRangeTo }}`;
        }
      }
      return keepFields(query, ['_id', '_index', ...topDedsFields]).limit(MAX_NUM_SPANS);
    },
    filter: boolFilter(
      ...rangeQuery(start, end),
      ...environmentQuery(environment),
      ...kqlQuery(kuery)
    ),
  });
  const spanHits = esqlRowsAsHits(spanResponse);

  // Span documents can be OTel-native or partial/legacy APM docs that do not always populate
  // every required field. Skipping a malformed hit keeps the whole request from failing with a 500.
  const spansAccessor = createApmEventFieldsAccessor({
    logger,
    operation: 'get_top_dependency_spans',
  });
  const spans = compactMap(spanHits, (hit) => spansAccessor.tryAccess(hit, topDedsRequiredFields));

  const traceIds = spans.map((span) => span[TRACE_ID]);

  const txRequiredFields = asMutableArray([
    TRACE_ID,
    TRANSACTION_ID,
    TRANSACTION_TYPE,
    TRANSACTION_NAME,
  ] as const);

  // No trace ids, no transactions to look up
  const transactionResponse = traceIds.length
    ? await apmEventClient.esql('get_transactions_for_dependency_spans', {
        apm: {
          events: [ProcessorEvent.transaction],
        },
        query: (index) =>
          keepFields(
            fromApmIndex(index, ['_id', '_index']).pipe`WHERE ${esql.col(TRACE_ID)} IN (${{
              traceIds,
            }}) AND ${esql.col(TRANSACTION_ID)} IS NOT NULL`.pipe`SORT ${esql.col(
              AT_TIMESTAMP
            )} DESC NULLS LAST`,
            ['_id', '_index', ...txRequiredFields]
          ).limit(traceIds.length),
      })
    : undefined;
  const transactionHits = esqlRowsAsHits(transactionResponse);

  const txAccessor = createApmEventFieldsAccessor({
    logger,
    operation: 'get_transactions_for_dependency_spans',
  });
  const transactions = compactMap(transactionHits, (hit) =>
    txAccessor.tryAccess(hit, txRequiredFields)
  );

  const transactionsByTraceId = keyBy(transactions, (transaction) => transaction[TRACE_ID]);

  return spans.map((span): DependencySpan => {
    const traceId = span[TRACE_ID];
    const transaction = maybe(transactionsByTraceId[traceId]);

    return {
      [AT_TIMESTAMP]: new Date(span[AT_TIMESTAMP]).getTime(),
      spanId: span[SPAN_ID],
      spanName: span[SPAN_NAME],
      serviceName: span[SERVICE_NAME],
      agentName: span[AGENT_NAME],
      duration: span[SPAN_DURATION],
      traceId,
      outcome: (span[EVENT_OUTCOME] || EventOutcome.unknown) as EventOutcome,
      transactionId: transaction?.[TRANSACTION_ID],
      transactionType: transaction?.[TRANSACTION_TYPE],
      transactionName: transaction?.[TRANSACTION_NAME],
    };
  });
}
