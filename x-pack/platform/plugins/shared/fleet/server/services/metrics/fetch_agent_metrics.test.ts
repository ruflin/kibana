/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClientMock } from '@kbn/core/server/mocks';
import { coreMock } from '@kbn/core/server/mocks';
import type { CoreSetup } from '@kbn/core/server';

import { fetchAgentMetrics } from './fetch_agent_metrics';

jest.mock('../../collectors/agent_collectors', () => {
  return {
    getAgentUsage: jest.fn().mockResolvedValue({}),
  };
});

describe('fetchAgentMetrics', () => {
  const { createSetup: coreSetupMock } = coreMock;
  const { signal } = new AbortController();
  let mockCore: CoreSetup;
  let esClient: ElasticsearchClientMock;

  beforeEach(async () => {
    mockCore = coreSetupMock();
    const [{ elasticsearch }] = await mockCore.getStartServices();
    esClient = elasticsearch.client.asInternalUser as ElasticsearchClientMock;
  });

  it('should not fetch agent if .fleet-agents is not created', async () => {
    esClient.indices.exists.mockResolvedValue(false);

    const result = await fetchAgentMetrics(mockCore, signal);

    expect(result).toBeUndefined();
  });

  it('should fetch agent metrics', async () => {
    esClient.esql.query.mockImplementation((async (request: { query: string }) => {
      if (request.query.includes('BY agent.version')) {
        return {
          columns: [
            { name: 'doc_count', type: 'long' },
            { name: 'agent.version', type: 'keyword' },
          ],
          values: [[1, '8.12.0']],
        };
      }
      if (request.query.includes('BY upgrade_details.state')) {
        return {
          columns: [
            { name: 'doc_count', type: 'long' },
            { name: 'upgrade_details.state', type: 'keyword' },
          ],
          values: [[1, 'UPG_REQUESTED']],
        };
      }
      return {
        columns: [
          { name: 'doc_count', type: 'long' },
          { name: 'unhealthy_reason', type: 'keyword' },
        ],
        values: [
          [2, 'input'],
          [1, 'output'],
          [3, 'other'],
        ],
      };
    }) as any);

    const result = await fetchAgentMetrics(mockCore, signal);

    expect(result).toEqual({
      agents: {},
      agents_per_version: [
        {
          version: '8.12.0',
          count: 1,
        },
      ],
      upgrading_step: {
        downloading: 0,
        extracting: 0,
        failed: 0,
        replacing: 0,
        requested: 1,
        restarting: 0,
        rollback: 0,
        scheduled: 0,
        watching: 0,
      },
      unhealthy_reason: {
        input: 2,
        output: 1,
        other: 3,
      },
    });
  });

  it('should count the active agents per version, the upgrade states and the unhealthy reasons with ES|QL', async () => {
    esClient.esql.query.mockResolvedValue({ columns: [], values: [] } as any);

    await fetchAgentMetrics(mockCore, signal);

    expect(esClient.esql.query.mock.calls.map(([request]) => (request as any).query)).toEqual([
      'FROM .fleet-agents | WHERE active == TRUE AND agent.version IS NOT NULL | STATS doc_count = COUNT(*) BY agent.version | SORT doc_count DESC, agent.version ASC | LIMIT 10',
      'FROM .fleet-agents | WHERE active == TRUE AND upgrade_details.state IS NOT NULL | STATS doc_count = COUNT(*) BY upgrade_details.state | SORT doc_count DESC, upgrade_details.state ASC | LIMIT 10',
      'FROM .fleet-agents | WHERE unhealthy_reason IS NOT NULL | STATS doc_count = COUNT(*) BY unhealthy_reason | SORT doc_count DESC, unhealthy_reason ASC | LIMIT 10',
    ]);
  });
});
