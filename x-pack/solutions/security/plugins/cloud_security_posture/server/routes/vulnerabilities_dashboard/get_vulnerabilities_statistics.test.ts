/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { getVulnerabilitiesStatistics } from './get_vulnerabilities_statistics';

describe('getVulnerabilitiesStatistics', () => {
  it('counts severities and distinct resources and accounts in one ES|QL STATS', async () => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    esClient.esql.query.mockResolvedValue({
      columns: [
        { name: 'critical', type: 'long' },
        { name: 'high', type: 'long' },
        { name: 'medium', type: 'long' },
        { name: 'resources_scanned', type: 'long' },
        { name: 'cloud_accounts', type: 'long' },
      ],
      values: [[1, 2, 3, 4, 5]],
    });

    const result = await getVulnerabilitiesStatistics(esClient);

    const request = esClient.esql.query.mock.calls[0][0] as { query: string; params: unknown };
    expect(request.query).toContain('| STATS critical = COUNT(*) WHERE vulnerability.severity ==');
    expect(request.query).toContain('resources_scanned = COUNT_DISTINCT(resource.id)');
    expect(request.params).toEqual([
      { critical: 'CRITICAL' },
      { high: 'HIGH' },
      { medium: 'MEDIUM' },
    ]);
    expect(result).toEqual({
      criticalCount: 1,
      highCount: 2,
      mediumCount: 3,
      resourcesScanned: 4,
      cloudAccounts: 5,
    });
  });
});
