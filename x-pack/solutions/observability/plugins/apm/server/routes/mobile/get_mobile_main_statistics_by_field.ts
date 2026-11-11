/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import { merge } from 'lodash';
import { calculateThroughputWithRange } from '@kbn/apm-data-access-plugin/server/utils';
import {
  SERVICE_NAME,
  SESSION_ID,
  TRANSACTION_DURATION,
  ERROR_TYPE,
} from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlRows } from '../../lib/helpers/esql_read';
import { toNumberOrNull, whereTerm } from '../../lib/helpers/esql_values';
import { ApmDocumentType } from '../../../common/document_type';
import { RollupInterval } from '../../../common/rollup';

interface Props {
  kuery: string;
  apmEventClient: APMEventClient;
  serviceName: string;
  environment: string;
  start: number;
  end: number;
  field: string;
}

export interface MobileMainStatisticsResponse {
  mainStatistics: Array<{
    name: string | number;
    latency: number | null;
    throughput: number;
    crashRate: number;
  }>;
}

type MergedQueriesResponse = Array<{
  name: string | number;
  latency: number | null;
  throughput: number;
  sessions: number;
  crashes?: number;
}>;

export async function getMobileMainStatisticsByField({
  kuery,
  apmEventClient,
  serviceName,
  environment,
  start,
  end,
  field,
}: Props) {
  const filter = {
    bool: {
      filter: [...rangeQuery(start, end), ...environmentQuery(environment), ...kqlQuery(kuery)],
    },
  };

  async function getMobileTransactionEventStatistics() {
    const response = await apmEventClient.esql(
      `get_mobile_transaction_events_main_statistics_by_field`,
      {
        apm: {
          sources: [
            {
              documentType: ApmDocumentType.TransactionEvent,
              rollupInterval: RollupInterval.None,
            },
          ],
        },
        // The fields are not mapped in every index, so unmapped fields read as null.
        query: (index) =>
          whereTerm(
            esql.from(index).addSetCommand('unmapped_fields', 'nullify'),
            SERVICE_NAME,
            serviceName
          ).pipe`WHERE ${esql.col(field)} IS NOT NULL`.pipe`STATS
              doc_count = COUNT(*),
              latency = AVG(${esql.col(TRANSACTION_DURATION)}),
              sessions = COUNT_DISTINCT(${esql.col(SESSION_ID)})
            BY ${esql.col(field)}`.pipe`SORT doc_count DESC, ${esql.col(field)} ASC`.limit(1000),
        filter,
      }
    );

    return esqlRows(response).map((row) => {
      return {
        name: row[field] as string | number,
        latency: toNumberOrNull(row.latency),
        throughput: calculateThroughputWithRange({
          start,
          end,
          value: Number(row.doc_count),
        }),
        sessions: Number(row.sessions),
      };
    });
  }

  async function getMobileErrorEventStatistics() {
    const response = await apmEventClient.esql(`get_mobile_crashes`, {
      apm: {
        sources: [
          {
            documentType: ApmDocumentType.ErrorEvent,
            rollupInterval: RollupInterval.None,
          },
        ],
      },
      query: (index) =>
        whereTerm(
          esql.from(index).addSetCommand('unmapped_fields', 'nullify'),
          SERVICE_NAME,
          serviceName
        ).pipe`WHERE ${esql.col(field)} IS NOT NULL`.pipe`STATS
            doc_count = COUNT(*),
            crashes = COUNT(*) WHERE ${esql.col(ERROR_TYPE)} == ${{ errorType: 'crash' }}
          BY ${esql.col(field)}`.pipe`SORT doc_count DESC, ${esql.col(field)} ASC`.limit(1000),
      filter,
    });
    return esqlRows(response).map((row) => {
      return {
        name: row[field] as string | number,
        crashes: Number(row.crashes ?? 0),
      };
    });
  }

  const [transactioEventStatistics, errorEventStatistics] = await Promise.all([
    getMobileTransactionEventStatistics(),
    getMobileErrorEventStatistics(),
  ]);

  const mainStatisticsMerged: MergedQueriesResponse = merge(
    transactioEventStatistics,
    errorEventStatistics
  );

  const mainStatistics = mainStatisticsMerged.map((item) => {
    return {
      name: item.name,
      latency: item.latency,
      throughput: item.throughput,
      crashRate: item.crashes ? item.crashes / item.sessions : 0,
    };
  });

  return { mainStatistics };
}
