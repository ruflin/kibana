/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getJourneyDetails } from './get_journey_details';
import { getUptimeESMockClient } from './test_helpers';

describe('getJourneyDetails', () => {
  describe('remoteName CCS index override', () => {
    const emptyResponse = { columns: [{ name: '_id', type: 'keyword' }], values: [] };

    const queryOf = (call: unknown[]): string => (call[0] as { query: string }).query;
    const filterOf = (call: unknown[]) => (call[0] as { filter?: any }).filter;

    it('does not override the index when remoteName is absent', async () => {
      const { esClient: mockEsClient, syntheticsEsClient } = getUptimeESMockClient();
      mockEsClient.esql.query.mockResolvedValueOnce(emptyResponse as any);

      await getJourneyDetails({
        syntheticsEsClient,
        checkGroup: 'check-group-1',
      });

      expect(queryOf(mockEsClient.esql.query.mock.calls[0])).toBe(
        `FROM ${syntheticsEsClient.heartbeatIndices} METADATA _id, _source | WHERE monitor.check_group == ?checkGroup | WHERE synthetics.type IN ("journey/start", "heartbeat/summary") | KEEP _id, _source | LIMIT 2`
      );
    });

    it('prefixes the index with remoteName when present', async () => {
      const { esClient: mockEsClient, syntheticsEsClient } = getUptimeESMockClient();
      mockEsClient.esql.query.mockResolvedValueOnce(emptyResponse as any);

      await getJourneyDetails({
        syntheticsEsClient,
        checkGroup: 'check-group-1',
        remoteName: 'cluster1',
      });

      expect(queryOf(mockEsClient.esql.query.mock.calls[0])).toMatch(
        new RegExp(`^FROM cluster1:${syntheticsEsClient.heartbeatIndices.replace('*', '\\*')} `)
      );
    });

    it('bounds the current-journey query by @timestamp when a timestamp is provided', async () => {
      const { esClient: mockEsClient, syntheticsEsClient } = getUptimeESMockClient();
      mockEsClient.esql.query.mockResolvedValueOnce(emptyResponse as any);

      await getJourneyDetails({
        syntheticsEsClient,
        checkGroup: 'check-group-1',
        timestamp: '2024-01-01T00:00:00.000Z',
      });

      expect(filterOf(mockEsClient.esql.query.mock.calls[0])).toEqual({
        range: {
          '@timestamp': {
            gte: '2023-12-31T23:00:00.000Z',
            lte: '2024-01-01T01:00:00.000Z',
          },
        },
      });
    });

    it('does not bound the current-journey query when no timestamp is provided', async () => {
      const { esClient: mockEsClient, syntheticsEsClient } = getUptimeESMockClient();
      mockEsClient.esql.query.mockResolvedValueOnce(emptyResponse as any);

      await getJourneyDetails({
        syntheticsEsClient,
        checkGroup: 'check-group-1',
      });

      expect(filterOf(mockEsClient.esql.query.mock.calls[0])).toBeUndefined();
    });

    it('prefixes the sibling-journey queries with remoteName when present', async () => {
      const { esClient: mockEsClient, syntheticsEsClient } = getUptimeESMockClient();

      // First call returns a journey/start hit so sibling queries fire.
      const journeyStartSource = {
        '@timestamp': '2024-01-01T00:00:00Z',
        monitor: { id: 'monitor-1', check_group: 'check-group-1' },
        observer: { geo: { name: 'us-east' } },
        synthetics: { type: 'journey/start' },
      };
      mockEsClient.esql.query.mockResolvedValueOnce({
        columns: [
          { name: '_id', type: 'keyword' },
          { name: '_source', type: '_source' },
        ],
        values: [['journey-1', journeyStartSource]],
      } as any);
      mockEsClient.esql.query.mockResolvedValueOnce(emptyResponse as any);
      mockEsClient.esql.query.mockResolvedValueOnce(emptyResponse as any);

      await getJourneyDetails({
        syntheticsEsClient,
        checkGroup: 'check-group-1',
        remoteName: 'cluster1',
      });

      const allCalls = mockEsClient.esql.query.mock.calls;
      expect(allCalls).toHaveLength(3);
      for (const call of allCalls) {
        expect(queryOf(call)).toMatch(/^FROM cluster1:synthetics-\*/);
      }
    });

    it('returns the previous and next journeys of the same monitor and location', async () => {
      const { esClient: mockEsClient, syntheticsEsClient } = getUptimeESMockClient();
      mockEsClient.esql.query.mockResolvedValueOnce({
        columns: [
          { name: '_id', type: 'keyword' },
          { name: '_source', type: '_source' },
        ],
        values: [
          [
            'journey-1',
            {
              '@timestamp': '2024-01-01T00:00:00Z',
              monitor: { id: 'monitor-1', check_group: 'check-group-1' },
              observer: { geo: { name: 'us-east' } },
              synthetics: { type: 'journey/start' },
            },
          ],
        ],
      } as any);
      const siblingColumns = [
        { name: '@timestamp', type: 'date' },
        { name: 'monitor.check_group', type: 'keyword' },
      ];
      mockEsClient.esql.query.mockImplementation((async (request: { query: string }) =>
        request.query.includes('@timestamp <')
          ? { columns: siblingColumns, values: [['2023-12-31T00:00:00.000Z', 'previous-group']] }
          : {
              columns: siblingColumns,
              values: [['2024-01-02T00:00:00.000Z', 'next-group']],
            }) as any);

      const result = await getJourneyDetails({ syntheticsEsClient, checkGroup: 'check-group-1' });

      expect(result?.journey._id).toBe('journey-1');
      expect(result?.previous).toEqual({
        checkGroup: 'previous-group',
        timestamp: '2023-12-31T00:00:00.000Z',
      });
      expect(result?.next).toEqual({
        checkGroup: 'next-group',
        timestamp: '2024-01-02T00:00:00.000Z',
      });
      const [, previousCall, nextCall] = mockEsClient.esql.query.mock.calls;
      expect(queryOf(previousCall)).toContain(
        'WHERE @timestamp < TO_DATETIME(?ts) | SORT @timestamp DESC NULLS LAST | KEEP @timestamp, monitor.check_group | LIMIT 1'
      );
      expect(queryOf(nextCall)).toContain(
        'WHERE @timestamp > TO_DATETIME(?ts) | SORT @timestamp ASC NULLS LAST | KEEP @timestamp, monitor.check_group | LIMIT 1'
      );
    });
  });
});
