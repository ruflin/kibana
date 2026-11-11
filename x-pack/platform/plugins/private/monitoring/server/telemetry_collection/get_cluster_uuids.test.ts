/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import sinon from 'sinon';
import {
  getClusterUuids,
  fetchClusterUuids,
  handleClusterUuidsResponse,
} from './get_cluster_uuids';

describe('get_cluster_uuids', () => {
  const searchMock = sinon.stub();
  const callCluster = { esql: { query: searchMock } } as unknown as ElasticsearchClient;

  afterEach(() => {
    searchMock.reset();
  });

  const response = {
    columns: [
      { name: 'count', type: 'long' },
      { name: 'cluster_uuid', type: 'keyword' },
    ],
    values: [
      [3, 'abc'],
      [2, 'xyz'],
      [1, '123'],
    ],
  };
  const rows = [
    { count: 3, cluster_uuid: 'abc' },
    { count: 2, cluster_uuid: 'xyz' },
    { count: 1, cluster_uuid: '123' },
  ];

  const expectedUuids = ['abc', 'xyz', '123'];

  const timestamp = Date.now();

  describe('getClusterUuids', () => {
    it('returns cluster UUIDs', async () => {
      searchMock.returns(Promise.resolve(response));
      expect(await getClusterUuids(callCluster, timestamp, 1)).toStrictEqual(expectedUuids);
    });
  });

  describe('fetchClusterUuids', () => {
    it('searches for clusters', async () => {
      searchMock.returns(Promise.resolve(response));
      expect(await fetchClusterUuids(callCluster, timestamp, 1)).toStrictEqual(rows);
      expect(searchMock.firstCall.args[0]).toMatchObject({
        query:
          'FROM .monitoring-es-* | WHERE cluster_uuid IS NOT NULL | STATS count = COUNT(*) BY cluster_uuid | LIMIT 1',
      });
    });

    it('returns no clusters when there is no monitoring index', async () => {
      searchMock.returns(
        Promise.reject({
          statusCode: 400,
          body: {
            error: { type: 'verification_exception', reason: 'Unknown index [.monitoring-es-*]' },
          },
        })
      );
      expect(await fetchClusterUuids(callCluster, timestamp, 1)).toStrictEqual([]);
    });
  });

  describe('handleClusterUuidsResponse', () => {
    it('handles unexpected response', () => {
      const clusterUuids = handleClusterUuidsResponse([]);
      expect(clusterUuids.length).toStrictEqual(0);
    });

    it('handles valid response', () => {
      const clusterUuids = handleClusterUuidsResponse(rows);
      expect(clusterUuids).toStrictEqual(expectedUuids);
    });

    it('handles no buckets response', () => {
      const clusterUuids = handleClusterUuidsResponse([]);

      expect(clusterUuids.length).toStrictEqual(0);
    });
  });
});
