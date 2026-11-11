/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getErrorDistribution } from './get_distribution';
import type { EsqlParamsMock } from '../../../utils/esql_test_helpers';
import { inspectEsqlParams, toEsqlRequest } from '../../../utils/esql_test_helpers';
import { ENVIRONMENT_ALL } from '../../../../common/environment_filter_values';

describe('error distribution queries', () => {
  let mock: EsqlParamsMock;

  afterEach(() => {
    mock.teardown();
  });

  it('fetches an error distribution', async () => {
    mock = await inspectEsqlParams(({ mockApmEventClient }) =>
      getErrorDistribution({
        serviceName: 'serviceName',
        apmEventClient: mockApmEventClient,
        environment: ENVIRONMENT_ALL.value,
        kuery: '',
        start: 0,
        end: 50000,
      })
    );

    expect(toEsqlRequest(mock.params)).toMatchSnapshot();
  });

  it('fetches an error distribution with a group id', async () => {
    mock = await inspectEsqlParams(({ mockApmEventClient }) =>
      getErrorDistribution({
        serviceName: 'serviceName',
        groupId: 'foo',
        apmEventClient: mockApmEventClient,
        environment: ENVIRONMENT_ALL.value,
        kuery: '',
        start: 0,
        end: 50000,
      })
    );

    expect(toEsqlRequest(mock.params)).toMatchSnapshot();
  });
});
