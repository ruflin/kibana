/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import moment from 'moment';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { estypes } from '@elastic/elasticsearch';
import { esql } from '@elastic/esql';
import { createQuery } from './create_query';
import { runEsqlRows, type EsqlRow } from '../lib/esql_read';
import {
  INDEX_PATTERN_ELASTICSEARCH,
  CLUSTER_DETAILS_FETCH_INTERVAL,
} from '../../common/constants';

/**
 * Get a list of Cluster UUIDs that exist within the specified timespan.
 */
export async function getClusterUuids(
  callCluster: ElasticsearchClient,
  timestamp: number,
  maxBucketSize: number
) {
  const response = await fetchClusterUuids(callCluster, timestamp, maxBucketSize);
  return handleClusterUuidsResponse(response);
}

/**
 * Fetch the Cluster UUIDs, one row per cluster, from the monitoring cluster.
 */
export async function fetchClusterUuids(
  callCluster: ElasticsearchClient,
  timestamp: number,
  maxBucketSize: number
) {
  const start = moment(timestamp).subtract(CLUSTER_DETAILS_FETCH_INTERVAL, 'ms').toISOString();

  const end = moment(timestamp).toISOString();

  // The time range and the monitoring type filters stay a Query DSL request filter.
  return await runEsqlRows(
    callCluster,
    esql.from([INDEX_PATTERN_ELASTICSEARCH]).pipe`WHERE cluster_uuid IS NOT NULL`
      .pipe`STATS count = COUNT(*) BY cluster_uuid`.limit(maxBucketSize),
    createQuery({
      start,
      end,
      filters: [
        {
          bool: {
            should: [
              { term: { type: 'cluster_stats' } },
              { term: { 'metricset.name': 'cluster_stats' } },
            ],
          },
        },
      ],
    }) as estypes.QueryDslQueryContainer
  );
}

/**
 * Convert the ES|QL rows into an array of Cluster UUIDs.
 *
 * @param {Array} rows The rows grouped by `cluster_uuid`
 * @return {Array} Strings; each representing a Cluster's UUID.
 */
export function handleClusterUuidsResponse(rows: EsqlRow[]): string[] {
  return rows.map((row) => row.cluster_uuid as string);
}
