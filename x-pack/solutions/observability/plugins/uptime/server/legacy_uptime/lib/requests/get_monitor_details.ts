/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import { CLIENT_ALERT_TYPES } from '../../../../common/constants/uptime_alerts';
import type { UMElasticsearchQueryFn } from '../adapters';
import type { MonitorDetails, Ping } from '../../../../common/runtime_types';
import { formatFilterString } from '../alerts/status_check';
import type { UptimeEsClient } from '../lib';
import { esqlRows } from '../esql_read';
import { createEsQuery } from '../../../../common/utils/es_search';

export interface GetMonitorDetailsParams {
  monitorId: string;
  dateStart: string;
  dateEnd: string;
  rulesClient: any;
}

export const getMonitorAlerts = async ({
  uptimeEsClient,
  rulesClient,
  monitorId,
}: {
  uptimeEsClient: UptimeEsClient;
  rulesClient: any;
  monitorId: string;
}) => {
  const options: any = {
    page: 1,
    perPage: 500,
    filter: `alert.attributes.alertTypeId:(${CLIENT_ALERT_TYPES.MONITOR_STATUS})`,
    defaultSearchOperator: 'AND',
    sortField: 'name.keyword',
  };

  const { data } = await rulesClient.find({ options });
  const monitorAlerts = [];
  for (let i = 0; i < data.length; i++) {
    const currAlert = data[i];

    if (currAlert.params.search?.includes(monitorId)) {
      monitorAlerts.push(currAlert);
      continue;
    }

    const parsedFilters: QueryDslQueryContainer | undefined = await formatFilterString(
      uptimeEsClient,
      currAlert.params.filters,
      currAlert.params.search
    );

    const esParams = createEsQuery({
      query: {
        bool: {
          filter: [
            {
              term: {
                'monitor.id': monitorId,
              },
            },
          ] as QueryDslQueryContainer[],
        },
      },
      size: 0,
      aggs: {
        monitors: {
          terms: {
            field: 'monitor.id',
            size: 1000,
          },
        },
      },
    });

    if (parsedFilters) {
      esParams.query.bool.filter.push(parsedFilters);
    }

    const { body: result } = await uptimeEsClient.search(
      esParams,
      `getMonitorsForAlert-${currAlert.name}`
    );

    if (result?.hits.total.value > 0) {
      monitorAlerts.push(currAlert);
    }
  }
  return monitorAlerts;
};

export const getMonitorDetails: UMElasticsearchQueryFn<
  GetMonitorDetailsParams,
  MonitorDetails
> = async ({ uptimeEsClient, monitorId, dateStart, dateEnd, rulesClient }) => {
  // The `error` object field cannot be filtered with a plain `WHERE`, and the range uses date math,
  // so both stay in the Query DSL filter. The whole `_source` is read because `error` is an object.
  const { response } = await uptimeEsClient.esql(
    (indices) =>
      esql.from(indices, ['_source']).pipe`WHERE monitor.id == ${{ monitorId }}`
        .pipe`SORT @timestamp DESC NULLS LAST`.pipe`KEEP _source`.limit(1),
    {
      operationName: 'getMonitorDetails',
      filter: {
        bool: {
          filter: [
            { exists: { field: 'error' } },
            { range: { '@timestamp': { gte: dateStart, lte: dateEnd } } },
          ],
        },
      },
    }
  );

  const data = esqlRows(response)[0]?._source as (Ping & { '@timestamp': string }) | undefined;

  const errorTimestamp: string | undefined = data?.['@timestamp'];
  const monAlerts = await getMonitorAlerts({
    uptimeEsClient,
    rulesClient,
    monitorId,
  });

  return {
    monitorId,
    error: data?.error,
    timestamp: errorTimestamp,
    alerts: monAlerts,
  };
};
