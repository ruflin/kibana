/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import { getSearchTransactionsEvents } from '.';
import type { APMEventClient } from '../create_es_client/create_apm_event_client';
import { SearchAggregatedTransactionSetting } from '../../../../common/aggregated_transactions';
import { ApmDocumentType } from '../../../../common/document_type';
import { RollupInterval } from '../../../../common/rollup';
import { boolFilter, hasEsqlDocuments } from '../esql_apm';
import type { APMConfig } from '../../..';

export async function getIsUsingTransactionEvents({
  config,
  apmEventClient,
  kuery,
  start,
  end,
}: {
  config: APMConfig;
  apmEventClient: APMEventClient;
  kuery: string;
  start?: number;
  end?: number;
}): Promise<boolean> {
  const searchesAggregatedTransactions = await getSearchTransactionsEvents({
    config,
    start,
    end,
    apmEventClient,
    kuery,
  });

  if (
    !searchesAggregatedTransactions &&
    config.searchAggregatedTransactions !== SearchAggregatedTransactionSetting.never
  ) {
    // if no aggregrated transactions, check if any transactions at all
    return await getHasTransactions({
      start,
      end,
      apmEventClient,
      kuery,
    });
  }

  return false;
}

async function getHasTransactions({
  start,
  end,
  apmEventClient,
  kuery,
}: {
  start?: number;
  end?: number;
  apmEventClient: APMEventClient;
  kuery: string;
}) {
  return hasEsqlDocuments({
    apmEventClient,
    operationName: 'get_has_transactions',
    apm: {
      sources: [
        {
          documentType: ApmDocumentType.TransactionEvent,
          rollupInterval: RollupInterval.None,
        },
      ],
    },
    filter: boolFilter(...(start && end ? rangeQuery(start, end) : []), ...kqlQuery(kuery)),
  });
}
