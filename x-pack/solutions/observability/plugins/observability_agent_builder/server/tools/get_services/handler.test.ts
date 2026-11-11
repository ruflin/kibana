/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import type {
  ObservabilityAgentBuilderCoreSetup,
  ObservabilityAgentBuilderPluginSetupDependencies,
} from '../../types';
import type { ObservabilityAgentBuilderDataRegistry } from '../../data_registry/data_registry';
import { getLogsIndices } from '../../utils/get_logs_indices';
import { getMetricsIndices } from '../../utils/get_metrics_indices';
import { getToolHandler } from './handler';

jest.mock('../../utils/get_logs_indices');
jest.mock('../../utils/get_metrics_indices');

describe('get_services handler', () => {
  const esClient = elasticsearchServiceMock.createScopedClusterClient();
  const dataRegistry = {
    getData: jest.fn().mockResolvedValue({ items: [] }),
  } as unknown as ObservabilityAgentBuilderDataRegistry;

  const run = () =>
    getToolHandler({
      core: {} as ObservabilityAgentBuilderCoreSetup,
      plugins: {} as ObservabilityAgentBuilderPluginSetupDependencies,
      request: {} as never,
      esClient,
      dataRegistry,
      logger: loggingSystemMock.createLogger(),
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-01T01:00:00.000Z',
      kqlFilter: 'service.name: a*',
    });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getLogsIndices).mockResolvedValue(['logs-*']);
    jest.mocked(getMetricsIndices).mockResolvedValue(['metrics-*']);
  });

  it('reads the services of the logs and metrics indices with one ES|QL query', async () => {
    esClient.asCurrentUser.esql.query.mockResolvedValue({
      columns: [
        { name: 'total', type: 'long' },
        { name: 'environment', type: 'keyword' },
        { name: 'service.name', type: 'keyword' },
      ],
      values: [
        [10, 'prod', 'checkout'],
        [4, null, 'cart'],
      ],
    } as never);

    const { services } = await run();

    expect(services).toEqual([
      { serviceName: 'checkout', environments: ['prod'] },
      { serviceName: 'cart', environments: undefined },
    ]);

    const request = esClient.asCurrentUser.esql.query.mock.calls[0][0] as {
      query: string;
      params: unknown[];
      filter: { bool: { filter: unknown[] } };
    };
    expect(request.query).toBe(
      'FROM logs-*, metrics-* | WHERE service.name IS NOT NULL | STATS doc_count = COUNT(*) BY service.name, service.environment | EVAL env_rank = CASE(service.environment IS NULL, 0, -doc_count) | STATS total = SUM(doc_count), environment = FIRST(service.environment, env_rank) BY service.name | SORT total DESC, service.name ASC | LIMIT ?limit'
    );
    expect(request.params).toEqual([{ limit: 500 }]);
    expect(request.filter.bool.filter).toHaveLength(2);
    expect(esClient.asCurrentUser.search).not.toHaveBeenCalled();
  });
});
