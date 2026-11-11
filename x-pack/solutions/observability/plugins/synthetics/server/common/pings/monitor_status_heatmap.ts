/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { SyntheticsEsClient } from '../../lib';
import { esqlRows } from '../../lib/esql_read';
import { getHeartbeatLocationFilter } from '../../../common/lib';
import { getSyntheticsScopedIndex } from '../../../common/get_synthetics_indices';
import type { MonitorStatusHeatmapBucket } from '../../../common/runtime_types';

const toNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);

export async function queryMonitorHeatmap({
  syntheticsEsClient,
  from,
  to,
  monitorId,
  location,
  intervalInMinutes,
  remoteName,
}: {
  syntheticsEsClient: SyntheticsEsClient;
  from: number | string;
  to: number | string;
  monitorId: string;
  location: string;
  intervalInMinutes: number;
  remoteName?: string;
}): Promise<MonitorStatusHeatmapBucket[]> {
  const index = getSyntheticsScopedIndex(remoteName, syntheticsEsClient.heartbeatIndices);
  const intervalMs = intervalInMinutes * 60 * 1000;

  // `date_histogram` with a fixed interval floors the epoch millis to a multiple of the interval,
  // which is the integer division below. The time range uses date math, the location filter may be
  // `must_not exists`, so both stay in the Query DSL filter.
  const response = await syntheticsEsClient.esql(
    esql.from(index.split(',')).pipe`STATS
        doc_count = COUNT(*),
        up = SUM(summary.up),
        down = SUM(summary.down)
      BY key = (TO_LONG(@timestamp) / ${{ intervalMs }}) * ${{ intervalMs }}`
      .pipe`SORT key ASC`.limit(10000),
    {
      operationName: 'queryMonitorHeatmap',
      filter: {
        bool: {
          filter: [
            { exists: { field: 'summary' } },
            { range: { '@timestamp': { gte: from, lte: to } } },
            { term: { 'monitor.id': monitorId } },
            // Autodiscovery/heartbeat pings carry no `observer.geo.name` and surface
            // under the "Heartbeat" placeholder label; a plain term on that placeholder
            // matches zero docs, so resolve it to a `must_not exists` clause instead.
            ...getHeartbeatLocationFilter({ field: 'observer.geo.name', value: location }),
          ],
        },
      },
    }
  );

  const byKey = new Map<number, MonitorStatusHeatmapBucket>();
  for (const row of esqlRows(response)) {
    const key = toNumber(row.key);
    byKey.set(key, {
      key,
      key_as_string: new Date(key).toISOString(),
      doc_count: toNumber(row.doc_count),
      up: { value: toNumber(row.up) },
      down: { value: toNumber(row.down) },
    });
  }

  // `date_histogram` returns the empty buckets between the first and the last one; STATS does not.
  const keys = [...byKey.keys()];
  if (keys.length === 0 || intervalMs <= 0) {
    return [];
  }
  const buckets: MonitorStatusHeatmapBucket[] = [];
  for (let key = Math.min(...keys); key <= Math.max(...keys); key += intervalMs) {
    buckets.push(
      byKey.get(key) ?? {
        key,
        key_as_string: new Date(key).toISOString(),
        doc_count: 0,
        up: { value: 0 },
        down: { value: 0 },
      }
    );
  }
  return buckets;
}
