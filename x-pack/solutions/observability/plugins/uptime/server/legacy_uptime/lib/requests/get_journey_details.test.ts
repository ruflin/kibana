/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getJourneyDetails } from './get_journey_details';
import { getUptimeESMockClient } from './test_helpers';

describe('getJourneyDetails', () => {
  let mockData: unknown;

  beforeEach(() => {
    mockData = {
      _id: 'uTjtNHoBu1okBtVwOgMb',
      _source: {
        '@timestamp': '2021-06-22T18:13:19.013Z',
        synthetics: {
          package_version: '1.0.0-beta.2',
          journey: {
            name: 'inline',
            id: 'inline',
          },
          payload: {
            source:
              'async ({ page, browser, params }) => {\n        scriptFn.apply(null, [core_1.step, page, browser, params]);\n    }',
            params: {},
          },
          index: 0,
          type: 'journey/start',
        },
        monitor: {
          name: 'My Monitor - inline',
          timespan: {
            lt: '2021-06-22T18:14:19.013Z',
            gte: '2021-06-22T18:13:19.013Z',
          },
          check_group: '85946468-d385-11eb-8848-acde48001122',
          id: 'my-browser-monitor-inline',
          type: 'browser',
          status: 'up',
        },
      },
    };
  });

  const journeyColumns = [
    { name: '_id', type: 'keyword' },
    { name: '_source', type: '_source' },
  ];
  const siblingColumns = [
    { name: '@timestamp', type: 'date' },
    { name: 'monitor.check_group', type: 'keyword' },
  ];

  it('formats ref detail data', async () => {
    const { esClient, uptimeEsClient } = getUptimeESMockClient();
    esClient.esql.query.mockImplementation((async (request: { query: string }) => {
      if (request.query.includes('@timestamp <')) {
        return {
          columns: siblingColumns,
          values: [['2021-06-22T18:12:19.013Z', 'previous-check-group']],
        };
      }
      if (request.query.includes('@timestamp >')) {
        return {
          columns: siblingColumns,
          values: [['2021-06-22T18:14:19.013Z', 'next-check-group']],
        };
      }
      return {
        columns: journeyColumns,
        values: [[(mockData as { _id: string })._id, (mockData as { _source: unknown })._source]],
      };
    }) as any);

    const result = await getJourneyDetails({
      uptimeEsClient,
      checkGroup: '85946468-d385-11eb-8848-acde48001122',
    });

    expect(result).toMatchObject({
      timestamp: '2021-06-22T18:13:19.013Z',
      journey: {
        _id: 'uTjtNHoBu1okBtVwOgMb',
        '@timestamp': '2021-06-22T18:13:19.013Z',
        monitor: { id: 'my-browser-monitor-inline', status: 'up', type: 'browser' },
        synthetics: { index: 0, type: 'journey/start' },
      },
      previous: { checkGroup: 'previous-check-group', timestamp: '2021-06-22T18:12:19.013Z' },
      next: { checkGroup: 'next-check-group', timestamp: '2021-06-22T18:14:19.013Z' },
    });

    const queries = esClient.esql.query.mock.calls.map(([request]) => (request as any).query);
    expect(queries).toEqual([
      'FROM heartbeat-* METADATA _id, _source | WHERE monitor.check_group == ?checkGroup | WHERE synthetics.type == "journey/start" | KEEP _id, _source | LIMIT 1',
      'FROM heartbeat-* | WHERE monitor.id == ?monitorId | WHERE synthetics.type == "journey/start" | WHERE @timestamp < TO_DATETIME(?ts) | SORT @timestamp DESC NULLS LAST | KEEP @timestamp, monitor.check_group | LIMIT 1',
      'FROM heartbeat-* | WHERE monitor.id == ?monitorId | WHERE synthetics.type == "journey/start" | WHERE @timestamp > TO_DATETIME(?ts) | SORT @timestamp ASC NULLS LAST | KEEP @timestamp, monitor.check_group | LIMIT 1',
    ]);
  });

  it('returns null for 0 hits', async () => {
    const { esClient, uptimeEsClient } = getUptimeESMockClient();
    esClient.esql.query.mockResolvedValue({ columns: journeyColumns, values: [] } as any);

    expect(await getJourneyDetails({ uptimeEsClient, checkGroup: 'check_group' })).toBe(null);
  });
});
