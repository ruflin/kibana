/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { rangeQuery } from '@kbn/observability-plugin/server';
import type { ServiceTransactionTypesResponse } from '@kbn/apm-api-shared';
import type { ApmServiceTransactionDocumentType } from '../../../common/document_type';
import { SERVICE_NAME, TRANSACTION_TYPE } from '../../../common/es_fields/apm';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import type { RollupInterval } from '../../../common/rollup';
import { esqlRows } from '../../lib/helpers/esql_read';

export async function getServiceTransactionTypes({
  apmEventClient,
  serviceName,
  start,
  end,
  documentType,
  rollupInterval,
}: {
  serviceName: string;
  apmEventClient: APMEventClient;
  start: number;
  end: number;
  documentType: ApmServiceTransactionDocumentType;
  rollupInterval: RollupInterval;
}): Promise<ServiceTransactionTypesResponse> {
  const response = await apmEventClient.esql('get_service_transaction_types', {
    apm: { sources: [{ documentType, rollupInterval }] },
    query: (index) =>
      esql.from(index).pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ serviceName }}`
        .pipe`STATS doc_count = COUNT(*) BY ${esql.col(TRANSACTION_TYPE)}`
        .pipe`SORT doc_count DESC, ${esql.col(TRANSACTION_TYPE)} ASC`.limit(100),
    filter: { bool: { filter: rangeQuery(start, end) } },
  });

  const transactionTypes = esqlRows(response)
    .map((row) => row[TRANSACTION_TYPE] as string)
    // we exclude page-exit transactions because they are not relevant for the apm app
    // and are only used for the INP values
    .filter((value) => value !== 'page-exit');
  return { transactionTypes };
}
