/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { rangeQuery } from '@kbn/observability-plugin/server';
import { accessKnownApmEventFields } from '@kbn/apm-data-access-plugin/server/utils';
import type { TransactionDetailRedirectInfo } from '@kbn/apm-types';
import { ApmDocumentType } from '../../../../common/document_type';
import {
  AT_TIMESTAMP,
  SERVICE_NAME,
  TRACE_ID,
  TRANSACTION_DURATION,
  TRANSACTION_ID,
  TRANSACTION_NAME,
  TRANSACTION_TYPE,
} from '../../../../common/es_fields/apm';
import { RollupInterval } from '../../../../common/rollup';
import { asMutableArray } from '../../../../common/utils/as_mutable_array';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlRowAsFields } from '../../../lib/helpers/esql_values';
import { environmentQuery } from '../../../../common/utils/environment_query';

export async function getTransactionByName({
  transactionName,
  serviceName,
  environment,
  apmEventClient,
  start,
  end,
}: {
  transactionName: string;
  serviceName: string;
  environment?: string;
  apmEventClient: APMEventClient;
  start: number;
  end: number;
}): Promise<TransactionDetailRedirectInfo | undefined> {
  const requiredFields = asMutableArray([
    AT_TIMESTAMP,
    TRACE_ID,
    TRANSACTION_ID,
    TRANSACTION_TYPE,
    TRANSACTION_NAME,
    TRANSACTION_DURATION,
    SERVICE_NAME,
  ] as const);

  const [firstField, ...otherFields] = requiredFields;

  const resp = await apmEventClient.esql('get_transaction', {
    apm: {
      sources: [
        {
          documentType: ApmDocumentType.TransactionEvent,
          rollupInterval: RollupInterval.None,
        },
      ],
    },
    // Any matching transaction will do, so the query has no sort.
    query: (index) =>
      esql.from(index).pipe`WHERE ${esql.col(TRANSACTION_NAME)} == ${{ transactionName }}`
        .pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ serviceName }}`
        .keep(firstField, ...otherFields)
        .limit(1),
    filter: {
      bool: {
        filter: [...rangeQuery(start, end), ...(environment ? environmentQuery(environment) : [])],
      },
    },
  });

  const fields = esqlRowAsFields(resp);

  return fields && accessKnownApmEventFields(fields).requireFields(requiredFields).unflatten();
}
