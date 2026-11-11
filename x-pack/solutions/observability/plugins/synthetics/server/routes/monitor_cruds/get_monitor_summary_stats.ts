/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { esql } from '@elastic/esql';
import { esqlRows } from '../../lib/esql_read';
import { routeId, MAX_DATE_RANGE_LENGTH, MAX_ROUTE_ID_LENGTH } from '../zod_query';
import { SYNTHETICS_API_URLS } from '../../../common/constants';
import {
  EXCLUDE_RUN_ONCE_FILTER,
  FINAL_SUMMARY_FILTER,
} from '../../../common/constants/client_defaults';
import { getHeartbeatLocationFilter } from '../../../common/lib';
import { getSyntheticsScopedIndex } from '../../../common/get_synthetics_indices';
import type { SyntheticsRestApiRouteFactory } from '../types';

export interface MonitorSummaryStats {
  availability: number;
  medianDuration: number;
  errorCount: number;
  totalRuns: number;
}

export const getMonitorSummaryStatsRoute: SyntheticsRestApiRouteFactory<
  MonitorSummaryStats
> = () => ({
  method: 'GET',
  writeAccess: false,
  path: SYNTHETICS_API_URLS.MONITOR_SUMMARY_STATS,
  validate: {
    query: z.strictObject({
      monitorId: routeId,
      locationLabel: z.string().max(MAX_ROUTE_ID_LENGTH),
      from: z.string().max(MAX_DATE_RANGE_LENGTH).default('now-30d'),
      to: z.string().max(MAX_DATE_RANGE_LENGTH).default('now'),
      remoteName: z.string().max(256).optional(),
    }),
  },
  handler: async ({ syntheticsEsClient, request }): Promise<MonitorSummaryStats> => {
    const { monitorId, locationLabel, from, to, remoteName } = request.query as {
      monitorId: string;
      locationLabel: string;
      from: string;
      to: string;
      remoteName?: string;
    };

    // Date math range, `must_not exists` locations and `exists` clauses stay in the Query DSL filter.
    const response = await syntheticsEsClient.esql(
      esql.from(
        getSyntheticsScopedIndex(remoteName, syntheticsEsClient.heartbeatIndices).split(',')
      ).pipe`STATS
          total = COUNT(summary.up),
          up = COUNT(*) WHERE monitor.status == "up",
          down = COUNT(*) WHERE monitor.status == "down",
          median_duration = PERCENTILE(monitor.duration.us, 50)`,
      {
        operationName: 'getMonitorSummaryStats',
        filter: {
          bool: {
            filter: [
              FINAL_SUMMARY_FILTER,
              EXCLUDE_RUN_ONCE_FILTER,
              { term: { 'monitor.id': monitorId } },
              ...getHeartbeatLocationFilter({ field: 'observer.geo.name', value: locationLabel }),
              { range: { '@timestamp': { gte: from, lte: to } } },
            ],
          },
        },
      }
    );

    const row = esqlRows(response)[0];
    const toNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);
    const total = toNumber(row?.total);
    const upCount = toNumber(row?.up);
    const downCount = toNumber(row?.down);

    const availability = total > 0 ? (upCount / total) * 100 : 0;
    const medianUs = toNumber(row?.median_duration);

    return {
      availability: Math.round(availability * 1000) / 1000,
      medianDuration: Math.round(medianUs / 1000),
      errorCount: downCount,
      totalRuns: total,
    };
  },
});
