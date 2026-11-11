/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import dateMath from '@kbn/datemath';
import { runEsqlRead } from '../../esql_helpers';

/**
 * The gate may widen its search beyond the run's time range when the range is empty.
 * Counting at least this far back keeps that behavior for recent alerts, while bounding
 * the query (7 days is also the default serverless search boost window).
 */
export const GATE_SCOPE_MIN_LOOKBACK = 'now-7d';

const DEFAULT_START = 'now-24h';
const DEFAULT_END = 'now';

const toIsoDate = (value: string, roundUp: boolean): string => {
  const parsed = dateMath.parse(value, { roundUp });
  if (!parsed?.isValid()) {
    throw new Error(`Invalid date math expression: ${value}`);
  }
  return parsed.toISOString();
};

/**
 * Counts the open and acknowledged, non-building-block alerts the ground-truthing gate could retrieve: those in the run's time range or the last 7 days.
 *
 * A missing alerts index counts as zero. Throws when any shard fails, so a partial count is never mistaken for zero.
 */
export const countGateScopeAlerts = async ({
  alertsIndexPattern,
  end,
  esClient,
  start,
}: {
  alertsIndexPattern: string;
  end?: string;
  esClient: ElasticsearchClient;
  start?: string;
}): Promise<number> => {
  const rangeStart = toIsoDate(start ?? DEFAULT_START, false);
  const rangeEnd = toIsoDate(end ?? DEFAULT_END, true);
  const minimumStart = toIsoDate(GATE_SCOPE_MIN_LOOKBACK, false);

  // Always `allow_partial_results: false`: a failed shard must error instead of undercounting.
  const query = esql.from([alertsIndexPattern])
    .pipe`WHERE kibana.alert.workflow_status IN ("open", "acknowledged")
    AND ((@timestamp >= TO_DATETIME(${{ rangeStart }}) AND @timestamp <= TO_DATETIME(${{
    rangeEnd,
  }})) OR @timestamp >= TO_DATETIME(${{ minimumStart }}))
    AND kibana.alert.building_block_type IS NULL`.pipe`STATS total = COUNT(*)`;

  const response = await runEsqlRead({ allowPartialResults: false, esClient, query });
  if (!response) return 0;

  if (response.is_partial) {
    throw new Error('Alert count was incomplete: one or more shards failed');
  }

  const total = response.values[0]?.[0];
  return typeof total === 'number' ? total : 0;
};
