/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import { fetchLicenseType } from './fetch_license_type';

describe('fetchLicenseType', () => {
  const clusterUuid = '1abcde2';
  const availableCcs = false;
  const callCluster = {
    esql: {
      query: jest.fn().mockImplementation(() => ({
        columns: [{ name: '_source', type: '_source' }],
        values: [[{ license: { type: 'trial' } }]],
      })),
    },
  } as unknown as ElasticsearchClient;

  it('should get the license type', async () => {
    const result = await fetchLicenseType(callCluster, availableCcs, clusterUuid);
    expect(result).toStrictEqual('trial');
    expect(callCluster.esql.query).toHaveBeenCalledWith({
      query:
        'FROM .monitoring-es-* METADATA _source | WHERE cluster_uuid == ?clusterUuid AND type == "cluster_stats" | SORT timestamp DESC NULLS LAST | KEEP _source | LIMIT 1',
      params: [{ clusterUuid }],
    });
  });

  it('should treat a missing monitoring index as no license data', async () => {
    const missingIndexCluster = {
      esql: {
        query: jest.fn().mockRejectedValue({
          statusCode: 400,
          body: {
            error: { type: 'verification_exception', reason: 'Unknown index [.monitoring-es-*]' },
          },
        }),
      },
    } as unknown as ElasticsearchClient;
    const result = await fetchLicenseType(missingIndexCluster, availableCcs, clusterUuid);
    expect(result).toBeUndefined();
  });

  it('should handle no license data', async () => {
    const customCallCluster = {
      esql: {
        query: jest.fn().mockImplementation(() => ({
          columns: [{ name: '_source', type: '_source' }],
          values: [],
        })),
      },
    } as unknown as ElasticsearchClient;
    const result = await fetchLicenseType(customCallCluster, availableCcs, clusterUuid);
    expect(result).toBeUndefined();
  });
});
