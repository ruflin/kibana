/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getIsUsingTransactionEvents } from './get_is_using_transaction_events';
import type { EsqlParamsMock } from '../../../utils/esql_test_helpers';
import { inspectEsqlParams, toEsqlRequest } from '../../../utils/esql_test_helpers';
import { SearchAggregatedTransactionSetting } from '../../../../common/aggregated_transactions';

const mockResponseNoHits = { columns: [{ name: '@timestamp', type: 'date' as const }], values: [] };

const mockResponseSomeHits = {
  columns: [{ name: '@timestamp', type: 'date' as const }],
  values: [['2024-01-01T00:00:00.000Z']],
};

describe('getIsUsingTransactionEvents', () => {
  let mock: EsqlParamsMock;

  afterEach(() => {
    mock.teardown();
  });

  describe('with config xpack.apm.searchAggregatedTransactions: never', () => {
    const config = {
      searchAggregatedTransactions: SearchAggregatedTransactionSetting.never,
    };

    it('should be false', async () => {
      mock = await inspectEsqlParams(
        ({ mockApmEventClient, mockConfig }) =>
          getIsUsingTransactionEvents({
            config: mockConfig,
            apmEventClient: mockApmEventClient,
            kuery: '',
          }),
        { config }
      );
      expect(mock.response).toBe(false);
    });

    it('should not query for data', async () => {
      mock = await inspectEsqlParams(
        ({ mockApmEventClient, mockConfig }) =>
          getIsUsingTransactionEvents({
            config: mockConfig,
            apmEventClient: mockApmEventClient,
            kuery: '',
          }),
        { config }
      );
      expect(mock.esqlSpy).toHaveBeenCalledTimes(0);
    });
  });

  describe('with config xpack.apm.searchAggregatedTransactions: always', () => {
    const config = {
      searchAggregatedTransactions: SearchAggregatedTransactionSetting.always,
    };
    it('should be false when kuery is empty', async () => {
      mock = await inspectEsqlParams(
        ({ mockApmEventClient, mockConfig }) =>
          getIsUsingTransactionEvents({
            config: mockConfig,
            apmEventClient: mockApmEventClient,
            kuery: '',
          }),
        { config }
      );
      expect(mock.response).toBe(false);
    });

    it('should be false when kuery is set and metrics data found', async () => {
      mock = await inspectEsqlParams(
        ({ mockApmEventClient, mockConfig }) =>
          getIsUsingTransactionEvents({
            config: mockConfig,
            apmEventClient: mockApmEventClient,
            kuery: 'proccessor.event: "transaction"',
          }),
        {
          config,
          mockEsqlResponse: (request) => {
            if (request === 'get_has_aggregated_transactions') {
              return mockResponseSomeHits;
            }
            if (request === 'get_has_transactions') {
              return mockResponseNoHits;
            }
            return mockResponseNoHits;
          },
        }
      );
      expect(mock.esqlSpy).toHaveBeenCalledTimes(1);
      expect(mock.response).toBe(false);
    });

    it('should be true when kuery is set and metrics data are not found', async () => {
      mock = await inspectEsqlParams(
        ({ mockApmEventClient, mockConfig }) =>
          getIsUsingTransactionEvents({
            config: mockConfig,
            apmEventClient: mockApmEventClient,
            kuery: 'proccessor.event: "transaction"',
          }),
        {
          config,
          mockEsqlResponse: (request) => {
            if (request === 'get_has_aggregated_transactions') {
              return mockResponseNoHits;
            }
            if (request === 'get_has_transactions') {
              return mockResponseSomeHits;
            }
            return mockResponseNoHits;
          },
        }
      );
      expect(mock.esqlSpy).toHaveBeenCalledTimes(2);
      expect(mock.response).toBe(true);
    });

    it('should not query for data when kuery is empty', async () => {
      mock = await inspectEsqlParams(
        ({ mockApmEventClient, mockConfig }) =>
          getIsUsingTransactionEvents({
            config: mockConfig,
            apmEventClient: mockApmEventClient,
            kuery: '',
          }),
        { config }
      );
      expect(mock.esqlSpy).toHaveBeenCalledTimes(0);
    });

    it('should query for data when kuery is set', async () => {
      mock = await inspectEsqlParams(
        ({ mockApmEventClient, mockConfig }) =>
          getIsUsingTransactionEvents({
            config: mockConfig,
            apmEventClient: mockApmEventClient,
            kuery: 'proccessor.event: "transaction"',
          }),
        { config, mockEsqlResponse: () => mockResponseSomeHits }
      );
      expect(mock.esqlSpy).toHaveBeenCalledTimes(1);
      expect(toEsqlRequest(mock.params)).toMatchSnapshot();
    });
  });

  describe('with config xpack.apm.searchAggregatedTransactions: auto', () => {
    const config = {
      searchAggregatedTransactions: SearchAggregatedTransactionSetting.auto,
    };

    it('should query for data once if metrics data found', async () => {
      mock = await inspectEsqlParams(
        ({ mockApmEventClient, mockConfig }) =>
          getIsUsingTransactionEvents({
            config: mockConfig,
            apmEventClient: mockApmEventClient,
            kuery: '',
          }),
        {
          config,
          mockEsqlResponse: (request) => {
            if (request === 'get_has_aggregated_transactions') {
              return mockResponseSomeHits;
            }
            if (request === 'get_has_transactions') {
              return mockResponseNoHits;
            }
            return mockResponseNoHits;
          },
        }
      );
      expect(mock.esqlSpy).toHaveBeenCalledTimes(1);
      expect(toEsqlRequest(mock.params)).toMatchSnapshot();
    });

    it('should query for data twice if metrics data not found', async () => {
      mock = await inspectEsqlParams(
        ({ mockApmEventClient, mockConfig }) =>
          getIsUsingTransactionEvents({
            config: mockConfig,
            apmEventClient: mockApmEventClient,
            kuery: '',
          }),
        {
          config,
          mockEsqlResponse: (request) => {
            if (request === 'get_has_aggregated_transactions') {
              return mockResponseNoHits;
            }
            if (request === 'get_has_transactions') {
              return mockResponseSomeHits;
            }
            return mockResponseNoHits;
          },
        }
      );
      expect(mock.esqlSpy).toHaveBeenCalledTimes(2);
      expect(
        mock.esqlSpy.mock.calls.map(([operationName, params]) => ({
          operationName,
          ...toEsqlRequest(params),
        }))
      ).toMatchSnapshot();
    });

    it('should be false if metrics data are found', async () => {
      mock = await inspectEsqlParams(
        ({ mockApmEventClient, mockConfig }) =>
          getIsUsingTransactionEvents({
            config: mockConfig,
            apmEventClient: mockApmEventClient,
            kuery: '',
          }),
        {
          config,
          mockEsqlResponse: (request) => {
            if (request === 'get_has_aggregated_transactions') {
              return mockResponseSomeHits;
            }
            if (request === 'get_has_transactions') {
              return mockResponseNoHits;
            }
            return mockResponseNoHits;
          },
        }
      );
      expect(mock.response).toBe(false);
    });

    it('should be true if no metrics data are found', async () => {
      mock = await inspectEsqlParams(
        ({ mockApmEventClient, mockConfig }) =>
          getIsUsingTransactionEvents({
            config: mockConfig,
            apmEventClient: mockApmEventClient,
            kuery: '',
          }),
        {
          config,
          mockEsqlResponse: (request) => {
            if (request === 'get_has_aggregated_transactions') {
              return mockResponseNoHits;
            }
            if (request === 'get_has_transactions') {
              return mockResponseSomeHits;
            }
            return mockResponseNoHits;
          },
        }
      );
      expect(mock.response).toBe(true);
    });

    it('should be false if no metrics or transactions data are found', async () => {
      mock = await inspectEsqlParams(
        ({ mockApmEventClient, mockConfig }) =>
          getIsUsingTransactionEvents({
            config: mockConfig,
            apmEventClient: mockApmEventClient,
            kuery: '',
          }),
        { config, mockEsqlResponse: () => mockResponseNoHits }
      );
      expect(mock.response).toBe(false);
    });
  });
});
