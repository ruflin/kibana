/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { ApmDocumentType } from '../../../common/document_type';
import { RollupInterval } from '../../../common/rollup';
import { esqlResponse, toEsqlRequest } from '../../utils/esql_test_helpers';
import { lookupServices } from './lookup_services';

describe('lookupServices', () => {
  const sources = [
    {
      documentType: ApmDocumentType.ServiceTransactionMetric,
      rollupInterval: RollupInterval.OneMinute,
      hasDurationSummaryField: true,
      hasDocs: true,
    },
  ];

  it('lists the services with the most documents, their environments and latest agent', async () => {
    const esql = jest
      .fn()
      .mockResolvedValueOnce(
        esqlResponse(
          ['doc_count', 'agent_name', 'service.name'],
          [
            [90, 'java', 'checkout'],
            [10, 'nodejs', 'cart'],
          ]
        )
      )
      .mockResolvedValueOnce(
        esqlResponse(
          ['doc_count', 'service.name', 'service.environment'],
          [
            [60, 'checkout', 'production'],
            [30, 'checkout', 'staging'],
            [10, 'cart', 'production'],
          ]
        )
      );

    const result = await lookupServices({
      apmEventClient: { esql } as unknown as APMEventClient,
      kuery: 'service.name: *',
      start: 0,
      end: 60 * 60 * 1000,
      maxNumberOfServices: 2,
      sources,
    });

    expect(result).toEqual([
      { serviceName: 'checkout', environments: ['production', 'staging'], agentName: 'java' },
      { serviceName: 'cart', environments: ['production'], agentName: 'nodejs' },
    ]);
    expect(toEsqlRequest(esql.mock.calls[0][1]).query).toBe(
      'FROM myIndex | STATS doc_count = COUNT(*), agent_name = LAST(`agent.name`, @timestamp) BY `service.name` | SORT doc_count DESC, `service.name` ASC | LIMIT 2'
    );
    const environments = toEsqlRequest(esql.mock.calls[1][1]);
    expect(environments.query).toContain('WHERE `service.name` IN (?serviceNames)');
    expect(environments.params).toEqual([{ serviceNames: ['checkout', 'cart'] }]);
  });

  it('returns no services, and reads no environments, when no service matches', async () => {
    const esql = jest.fn().mockResolvedValue(undefined);

    const result = await lookupServices({
      apmEventClient: { esql } as unknown as APMEventClient,
      kuery: '',
      start: 0,
      end: 1000,
      maxNumberOfServices: 10,
      sources,
    });

    expect(result).toEqual([]);
    expect(esql).toHaveBeenCalledTimes(1);
  });
});
