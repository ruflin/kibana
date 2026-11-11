/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql, type ComposerQuery } from '@elastic/esql';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { rangeQuery } from '@kbn/observability-plugin/server';
import type { ConnectionTransactionsResponse } from '@kbn/apm-api-shared';
import {
  AT_TIMESTAMP,
  EVENT_OUTCOME,
  PARENT_ID,
  SERVICE_NAME,
  SPAN_DESTINATION_SERVICE_RESOURCE,
  SPAN_DURATION,
  SPAN_ID,
  TRANSACTION_ID,
  TRANSACTION_NAME,
  TRANSACTION_TYPE,
} from '../../../common/es_fields/apm';
import { EventOutcome } from '../../../common/event_outcome';
import { environmentQuery } from '../../../common/utils/environment_query';
import type { Environment } from '../../../common/environment_rt';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlRowsAsFields } from '../../lib/helpers/esql_values';
import { withApmSpan } from '../../utils/with_apm_span';
import { CONNECTION_JOIN_TIME_BUFFER_MS, MAX_CONNECTION_IDS } from './connection_constants';

/** Maximum number of transaction groups (distinct transaction names) returned. */
const MAX_TRANSACTION_GROUPS = 100;

interface ExitSpanCall {
  transactionId: string;
  durationUs: number;
  outcome: string | undefined;
}

/**
 * Transactions of the source service that call a connection, with the metrics of those calls.
 *
 * The calls are the exit spans of the source service that belong to the connection, matched on
 * the connection's resources (`dependencies`) like the failed calls are. Edges without resources
 * (service → service edges of the AI Agent map) fall back to the exit spans that are the parent
 * of an entry transaction of the target; that path spends the id budget on the target's whole
 * inbound traffic, so a busy target can leave this edge undersampled.
 *
 * A span document does not carry the name of its transaction, so the names are resolved through
 * the transaction documents of the source (`transaction.id`). Latency and failure rate are the
 * ones of the exit spans, not of the whole transaction. The newest {@link MAX_CONNECTION_IDS}
 * calls are used; `isSampled` tells when older ones are left out.
 */
export function getConnectionTransactions({
  apmEventClient,
  sourceServiceName,
  targetServiceName,
  dependencies,
  environment,
  start,
  end,
}: {
  apmEventClient: APMEventClient;
  sourceServiceName: string;
  targetServiceName?: string;
  dependencies: string[];
  environment: Environment;
  start: number;
  end: number;
}): Promise<ConnectionTransactionsResponse> {
  return withApmSpan('get_connection_transactions', async () => {
    let scopeWhere: (query: ComposerQuery) => ComposerQuery;
    let isSampled = false;

    if (dependencies.length > 0) {
      scopeWhere = (query) =>
        query.pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ sourceServiceName }}`
          .pipe`WHERE ${esql.col(SPAN_DESTINATION_SERVICE_RESOURCE)} IN (${{ dependencies }})`;
    } else if (targetServiceName) {
      // The parent ids of the newest entry transactions of the target: the span ids of the exit
      // spans that called it. The parent id is specific to the call, so the environment of the
      // target is not filtered (the exit span query filters the source's environment).
      // One row more than the budget tells whether older ones were left out.
      const entryTransactionsResponse = await apmEventClient.esql(
        'get_connection_transactions_target_parent_ids',
        {
          apm: { events: [ProcessorEvent.transaction] },
          query: (index) =>
            esql.from(index).pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ targetServiceName }}`
              .pipe`WHERE ${esql.col(PARENT_ID)} IS NOT NULL`.pipe`SORT ${esql.col(
              AT_TIMESTAMP
            )} DESC NULLS LAST`
              .keep(PARENT_ID)
              .limit(MAX_CONNECTION_IDS + 1),
          filter: { bool: { filter: rangeQuery(start, end) } },
        }
      );

      const entryTransactionRows = esqlRowsAsFields(entryTransactionsResponse);
      const parentIds = entryTransactionRows
        .slice(0, MAX_CONNECTION_IDS)
        .map((fields) => fields[PARENT_ID]?.[0])
        .filter((parentId): parentId is string => typeof parentId === 'string');

      if (parentIds.length === 0) {
        return { transactionGroups: [], isSampled: false };
      }

      isSampled = entryTransactionRows.length > MAX_CONNECTION_IDS;
      scopeWhere = (query) =>
        query.pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ sourceServiceName }}`
          .pipe`WHERE ${esql.col(SPAN_ID)} IN (${{ parentIds }})`;
    } else {
      // Unreachable: the route schema requires dependencies or targetServiceName.
      return { transactionGroups: [], isSampled: false };
    }

    const exitSpansResponse = await apmEventClient.esql('get_connection_transactions_exit_spans', {
      apm: { events: [ProcessorEvent.span] },
      query: (index) =>
        scopeWhere(esql.from(index)).pipe`SORT ${esql.col(AT_TIMESTAMP)} DESC NULLS LAST`
          .keep(TRANSACTION_ID, SPAN_DURATION, EVENT_OUTCOME)
          .limit(MAX_CONNECTION_IDS + 1),
      filter: {
        bool: { filter: [...rangeQuery(start, end), ...environmentQuery(environment)] },
      },
    });

    const exitSpanRows = esqlRowsAsFields(exitSpansResponse);
    const calls: ExitSpanCall[] = exitSpanRows.slice(0, MAX_CONNECTION_IDS).flatMap((fields) => {
      const transactionId = fields[TRANSACTION_ID]?.[0];
      if (typeof transactionId !== 'string') {
        return [];
      }
      return {
        transactionId,
        durationUs: Number(fields[SPAN_DURATION]?.[0] ?? 0),
        outcome: fields[EVENT_OUTCOME]?.[0] as string | undefined,
      };
    });

    if (calls.length === 0) {
      return { transactionGroups: [], isSampled };
    }

    isSampled = isSampled || exitSpanRows.length > MAX_CONNECTION_IDS;

    // The name and type of the transaction of each call. A transaction starts before its exit
    // spans, so the range reaches back beyond the window to still resolve calls near its start.
    const callTransactionIds = [...new Set(calls.map((c) => c.transactionId))];
    const transactionsResponse = await apmEventClient.esql('get_connection_transactions_names', {
      apm: { events: [ProcessorEvent.transaction] },
      query: (index) =>
        esql.from(index).pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ sourceServiceName }}`
          .pipe`WHERE ${esql.col(TRANSACTION_ID)} IN (${{ callTransactionIds }})`
          .keep(TRANSACTION_ID, TRANSACTION_NAME, TRANSACTION_TYPE)
          .limit(MAX_CONNECTION_IDS),
      filter: { bool: { filter: rangeQuery(start - CONNECTION_JOIN_TIME_BUFFER_MS, end) } },
    });

    const transactionById = new Map<string, { name: string; type: string }>();
    for (const fields of esqlRowsAsFields(transactionsResponse)) {
      const id = fields[TRANSACTION_ID]?.[0];
      const name = fields[TRANSACTION_NAME]?.[0];
      if (typeof id === 'string' && typeof name === 'string') {
        transactionById.set(id, { name, type: String(fields[TRANSACTION_TYPE]?.[0] ?? '') });
      }
    }

    const groups = new Map<
      string,
      {
        transactionType: string;
        callCount: number;
        failedCount: number;
        knownOutcomeCount: number;
        totalDurationUs: number;
      }
    >();
    let totalCallTime = 0;
    for (const call of calls) {
      const transaction = transactionById.get(call.transactionId);
      if (!transaction) {
        continue;
      }
      const group = groups.get(transaction.name) ?? {
        transactionType: transaction.type,
        callCount: 0,
        failedCount: 0,
        knownOutcomeCount: 0,
        totalDurationUs: 0,
      };
      group.callCount += 1;
      group.failedCount += call.outcome === EventOutcome.failure ? 1 : 0;
      // Unknown outcomes are not successes: the rate only counts spans that reported one.
      group.knownOutcomeCount +=
        call.outcome === EventOutcome.failure || call.outcome === EventOutcome.success ? 1 : 0;
      group.totalDurationUs += call.durationUs;
      groups.set(transaction.name, group);
      totalCallTime += call.durationUs;
    }

    const rangeInMinutes = (end - start) / 1000 / 60;
    const transactionGroups = [...groups.entries()]
      .map(([name, group]) => ({
        name,
        transactionType: group.transactionType,
        avgCallLatency: group.callCount > 0 ? group.totalDurationUs / group.callCount : null,
        callCount: group.callCount,
        callRate: rangeInMinutes > 0 ? group.callCount / rangeInMinutes : null,
        failedCallRate:
          group.knownOutcomeCount > 0 ? group.failedCount / group.knownOutcomeCount : null,
        timeConsumedPct: totalCallTime > 0 ? group.totalDurationUs / totalCallTime : null,
      }))
      .sort((a, b) => b.callCount - a.callCount)
      .slice(0, MAX_TRANSACTION_GROUPS);

    return { transactionGroups, isSampled };
  });
}
