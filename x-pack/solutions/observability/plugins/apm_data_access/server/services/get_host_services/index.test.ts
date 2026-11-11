/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ApmDocumentType } from '../../../common/document_type';
import { RollupInterval } from '../../../common/rollup';
import type { ApmDataAccessServicesParams } from '../get_services';
import { createGetHostServices } from '.';

const columns = ['doc_count', 'latest_timestamp', 'agent_name', 'service.name'].map((name) => ({
  name,
  type: 'keyword',
}));

describe('getHostServices', () => {
  const documentSources = [
    {
      documentType: ApmDocumentType.TransactionMetric,
      rollupInterval: RollupInterval.OneMinute,
      hasDocs: true,
      hasDurationSummaryField: true,
    },
    {
      documentType: ApmDocumentType.ErrorEvent,
      rollupInterval: RollupInterval.None,
      hasDocs: true,
      hasDurationSummaryField: false,
    },
  ];

  const getServices = async (
    metricsRows: unknown[][],
    logsRows: unknown[][],
    filters: Record<string, string> = {}
  ) => {
    const esql = jest
      .fn()
      .mockResolvedValueOnce({ columns, values: metricsRows })
      .mockResolvedValueOnce({ columns, values: logsRows });
    const getHostServices = createGetHostServices({
      apmEventClient: { esql },
    } as unknown as ApmDataAccessServicesParams);

    const { services } = await getHostServices({
      start: 0,
      end: 3_600_000,
      filters,
      documentSources,
    });
    return { services, esql };
  };

  it('keeps the agent name of the latest document of a service across metrics and logs', async () => {
    const { services } = await getServices(
      [
        [10, '2024-01-01T00:00:00.000Z', 'java', 'checkout'],
        [5, '2024-01-01T00:00:00.000Z', 'go', 'cart'],
      ],
      [[2, '2024-01-02T00:00:00.000Z', 'nodejs', 'checkout']]
    );

    expect(services).toEqual([
      { serviceName: 'checkout', agentName: 'nodejs' },
      { serviceName: 'cart', agentName: 'go' },
    ]);
  });

  it('groups the services of metrics and logs by their latest agent, filtered by host', async () => {
    const { esql } = await getServices([], [], { 'host.name': 'host-1' });

    const [metricsCall, logsCall] = esql.mock.calls;
    expect(metricsCall[0]).toBe('get_apm_host_services_from_metrics');
    expect(logsCall[0]).toBe('get_apm_host_services_from_logs');
    expect(metricsCall[1].query(['idx']).toRequest()).toEqual({
      query:
        'SET unmapped_fields = "nullify"; FROM idx | WHERE `service.name` IS NOT NULL | STATS doc_count = COUNT(*), latest_timestamp = MAX(@timestamp), agent_name = LAST(`agent.name`, @timestamp) BY `service.name` | SORT doc_count DESC, `service.name` ASC | LIMIT 1000',
      params: [],
    });
    expect(logsCall[1].filter.bool.filter).toContainEqual({
      bool: {
        should: [{ term: { 'host.name': 'host-1' } }],
        minimum_should_match: 1,
      },
    });
  });
});
