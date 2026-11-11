/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlResponse, toEsqlRequest } from '../../utils/esql_test_helpers';
import { hasUnsetValueForFields } from './has_unset_value_for_fields';

describe('hasUnsetValueForFields', () => {
  const params = {
    searchAggregatedTransactions: true,
    fieldNames: ['service.environment', 'resource.attributes.deployment.environment.name'],
    start: 0,
    end: 1000,
  };

  it.each([
    ['true when a document has none of the fields', [['svc']], true],
    ['false when every document has one of the fields', [], false],
  ])('is %s', async (_name, values, expected) => {
    const esql = jest.fn().mockResolvedValue(esqlResponse(['service.name'], values));

    const result = await hasUnsetValueForFields({
      ...params,
      serviceName: 'svc',
      apmEventClient: { esql } as unknown as APMEventClient,
    });

    expect(result).toBe(expected);
  });

  it('looks for one document where all the fields are null', async () => {
    const esql = jest.fn().mockResolvedValue(esqlResponse(['service.name'], []));

    await hasUnsetValueForFields({
      ...params,
      serviceName: undefined,
      apmEventClient: { esql } as unknown as APMEventClient,
    });

    expect(toEsqlRequest(esql.mock.calls[0][1]).query).toBe(
      'SET unmapped_fields = "nullify"; FROM myIndex | WHERE `service.environment` IS NULL AND `resource.attributes.deployment.environment.name` IS NULL | KEEP `service.name` | LIMIT 1'
    );
  });
});
