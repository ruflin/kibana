/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import { esql } from '@elastic/esql';
import { getLogErrorRate, getLogRatePerMinute } from '../../utils';
import { LOG_LEVEL } from '../../es_fields';
import { getRows, runEsqlQuery } from '../../utils/esql';

// The default size of the `terms` aggregation this query replaced.
const MAX_SERVICES = 10;

export interface LogsRatesServiceParams {
  esClient: ElasticsearchClient;
  serviceNames: string[];
  identifyingMetadata: string;
  timeFrom: number;
  timeTo: number;
}

export interface LogsRatesMetrics {
  logRatePerMinute: number;
  logErrorRate: null | number;
}

export interface LogsRatesServiceReturnType {
  [serviceName: string]: LogsRatesMetrics;
}

export function createGetLogsRatesService() {
  return async ({
    esClient,
    identifyingMetadata,
    serviceNames,
    timeFrom,
    timeTo,
  }: LogsRatesServiceParams): Promise<LogsRatesServiceReturnType> => {
    // The `terms` aggregation returned the 10 largest services, and the error count of a service
    // was its largest `error` / `ERROR` bucket. `GREATEST` and `LIMIT 10` keep both.
    const response = await runEsqlQuery({
      esClient,
      // The clauses stay a request filter: `identifyingMetadata` can be a multi-valued field, which
      // `WHERE` does not match.
      filter: {
        bool: {
          filter: [
            {
              exists: {
                // For now, we don't want to count APM server logs or any other logs that don't have the log.level field.
                field: LOG_LEVEL,
              },
            },
            {
              terms: {
                [identifyingMetadata]: serviceNames,
              },
            },
            {
              range: {
                ['@timestamp']: {
                  gte: timeFrom,
                  lte: timeTo,
                  format: 'epoch_millis',
                },
              },
            },
          ],
        },
      },
      query: esql.from(['logs-*-*'])
        .pipe`STATS log_count = COUNT(*), error_count = COUNT(*) WHERE log.level == "error", upper_error_count = COUNT(*) WHERE log.level == "ERROR" BY service = ${esql.col(
        identifyingMetadata.split('.')
      )}`.pipe`EVAL log_error_count = GREATEST(error_count, upper_error_count)`
        .pipe`SORT log_count DESC, service ASC`.limit(MAX_SERVICES),
    });

    return getRows(response).reduce<LogsRatesServiceReturnType>((acc, row) => {
      const logCount = Number(row.log_count);
      const logErrorCount = Number(row.log_error_count);

      return {
        ...acc,
        [String(row.service)]: {
          logRatePerMinute: getLogRatePerMinute({ logCount, timeFrom, timeTo }),
          logErrorRate: logErrorCount ? getLogErrorRate({ logCount, logErrorCount }) : null,
        },
      };
    }, {});
  };
}
