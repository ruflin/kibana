/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { queryMonitorHeatmap } from './monitor_status_heatmap';
import { HEARTBEAT_UNMAPPED_LOCATION_LABEL } from '../../../common/runtime_types/heartbeat_monitor';

const runQuery = async (location: string) => {
  const esqlFn = jest.fn().mockResolvedValue({ columns: [], values: [] });
  await queryMonitorHeatmap({
    // @ts-expect-error partial client for testing
    syntheticsEsClient: { esql: esqlFn, heartbeatIndices: 'synthetics-*' },
    from: 'now-24h',
    to: 'now',
    monitorId: 'my-monitor',
    location,
    intervalInMinutes: 60,
  });
  return esqlFn.mock.calls[0][1].filter.bool.filter;
};

describe('queryMonitorHeatmap', () => {
  afterEach(() => jest.clearAllMocks());

  it('filters by observer.geo.name for a real location', async () => {
    const filters = await runQuery('North America - US East');

    expect(filters).toContainEqual({ term: { 'observer.geo.name': 'North America - US East' } });
  });

  // Regression: autodiscovery/heartbeat pings carry no observer.geo.name and are
  // surfaced under the "Heartbeat" placeholder. A plain term on the placeholder
  // label matches zero pings, so the status heatmap ("Downtime history") rendered
  // empty for those monitors.
  it('matches location-less pings for the Heartbeat placeholder', async () => {
    const filters = await runQuery(HEARTBEAT_UNMAPPED_LOCATION_LABEL);

    expect(filters).toContainEqual({
      bool: { must_not: { exists: { field: 'observer.geo.name' } } },
    });
    expect(filters).not.toContainEqual({
      term: { 'observer.geo.name': HEARTBEAT_UNMAPPED_LOCATION_LABEL },
    });
  });

  it('buckets the pings by interval and fills the empty buckets between the first and last', async () => {
    const hour = 60 * 60 * 1000;
    const esqlFn = jest.fn().mockResolvedValue({
      columns: [
        { name: 'doc_count', type: 'long' },
        { name: 'up', type: 'long' },
        { name: 'down', type: 'long' },
        { name: 'key', type: 'long' },
      ],
      values: [
        [3, 3, 0, 0],
        [2, 1, 1, 3 * hour],
      ],
    });

    const buckets = await queryMonitorHeatmap({
      // @ts-expect-error partial client for testing
      syntheticsEsClient: { esql: esqlFn, heartbeatIndices: 'synthetics-*' },
      from: 'now-24h',
      to: 'now',
      monitorId: 'my-monitor',
      location: 'North America - US East',
      intervalInMinutes: 60,
    });

    const request = esqlFn.mock.calls[0][0].toRequest();
    expect(request.query).toBe(
      'FROM synthetics-* | STATS doc_count = COUNT(*), up = SUM(summary.up), down = SUM(summary.down) BY `key` = TO_LONG(@timestamp) / ?intervalMs * ?p1 | SORT `key` ASC | LIMIT 10000'
    );
    expect(request.params).toContainEqual({ intervalMs: hour });
    expect(buckets.map((bucket) => [bucket.key, bucket.doc_count, bucket.down.value])).toEqual([
      [0, 3, 0],
      [hour, 0, 0],
      [2 * hour, 0, 0],
      [3 * hour, 2, 1],
    ]);
    expect(buckets[0].key_as_string).toBe('1970-01-01T00:00:00.000Z');
  });
});
