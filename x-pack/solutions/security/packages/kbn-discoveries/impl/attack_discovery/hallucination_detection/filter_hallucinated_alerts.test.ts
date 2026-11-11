/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';
import { loggerMock } from '@kbn/logging-mocks';
import { filterHallucinatedAlerts } from './filter_hallucinated_alerts';
import type { DiscoveryWithAlertIds } from './types';

const mockEsClient = elasticsearchServiceMock.createElasticsearchClient();
const mockEsqlQuery = mockEsClient.esql.query as unknown as jest.Mock;

const esqlIds = (...ids: Array<string | null>) => ({
  columns: [{ name: '_id', type: 'keyword' }],
  values: ids.map((id) => [id]),
});
const mockLogger = loggerMock.create();

describe('filterHallucinatedAlerts', () => {
  const alertsIndexPattern = '.alerts-security.alerts-*';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockDiscovery1: DiscoveryWithAlertIds = {
    alertIds: ['alert-1', 'alert-2'],
    title: 'Discovery 1',
  };

  const mockDiscovery2: DiscoveryWithAlertIds = {
    alertIds: ['alert-3'],
    title: 'Discovery 2',
  };

  const mockDiscovery3: DiscoveryWithAlertIds = {
    alertIds: ['alert-4', 'alert-5'],
    title: 'Discovery 3',
  };

  const mockDiscoveryWithSnakeCase: DiscoveryWithAlertIds = {
    alert_ids: ['alert-6', 'alert-7'],
    title: 'Discovery with snake_case',
  };

  const defaultProps = {
    alertsIndexPattern,
    attackDiscoveries: [mockDiscovery1, mockDiscovery2, mockDiscovery3],
    esClient: mockEsClient,
    logger: mockLogger,
  };

  const getEsqlQuery = (): string => mockEsqlQuery.mock.calls[0][0].query;

  // Helper to extract the actual message from a lazy-evaluated logger call
  const getInfoMessage = (): string => {
    const infoCall = mockLogger.info.mock.calls[0]?.[0];
    return typeof infoCall === 'function' ? infoCall() : infoCall;
  };

  const getDebugMessage = (callIndex: number = 0): string => {
    const debugCall = mockLogger.debug.mock.calls[callIndex]?.[0];
    return typeof debugCall === 'function' ? debugCall() : debugCall;
  };

  describe('when no discoveries are provided', () => {
    it('returns an empty array', async () => {
      const result = await filterHallucinatedAlerts({
        ...defaultProps,
        attackDiscoveries: [],
      });

      expect(result).toEqual([]);
    });

    it('does NOT call ES when no discoveries are generated', async () => {
      await filterHallucinatedAlerts({
        ...defaultProps,
        attackDiscoveries: [],
      });

      expect(mockEsqlQuery).not.toHaveBeenCalled();
    });
  });

  describe('when all alert IDs exist', () => {
    beforeEach(() => {
      mockEsqlQuery.mockResolvedValue(
        esqlIds('alert-1', 'alert-2', 'alert-3', 'alert-4', 'alert-5')
      );
    });

    it('returns all discoveries', async () => {
      const result = await filterHallucinatedAlerts(defaultProps);

      expect(result).toEqual([mockDiscovery1, mockDiscovery2, mockDiscovery3]);
    });

    it('does NOT log when no discoveries are filtered', async () => {
      await filterHallucinatedAlerts(defaultProps);

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('queries ES with the correct index pattern', async () => {
      await filterHallucinatedAlerts(defaultProps);

      expect(getEsqlQuery()).toMatch(/^FROM \.alerts-security\.alerts-\* METADATA _id \| /);
    });

    it('queries ES with the correct size', async () => {
      await filterHallucinatedAlerts(defaultProps);

      expect(getEsqlQuery()).toMatch(/\| LIMIT 5$/); // unique alert IDs
    });

    it('queries ES with an IN filter containing all unique alert IDs', async () => {
      await filterHallucinatedAlerts(defaultProps);

      expect(getEsqlQuery()).toContain(
        'WHERE _id IN ("alert-1", "alert-2", "alert-3", "alert-4", "alert-5")'
      );
    });

    it('deduplicates alert IDs before querying', async () => {
      const discoveryWithDuplicates: DiscoveryWithAlertIds = {
        alertIds: ['alert-1', 'alert-1', 'alert-2'],
        title: 'Discovery with duplicates',
      };

      await filterHallucinatedAlerts({
        ...defaultProps,
        attackDiscoveries: [discoveryWithDuplicates],
      });

      expect(getEsqlQuery()).toContain('WHERE _id IN ("alert-1", "alert-2")');
      expect(getEsqlQuery()).toMatch(/\| LIMIT 2$/);
    });

    it('queries ES for the _id column only', async () => {
      await filterHallucinatedAlerts(defaultProps);

      expect(getEsqlQuery()).toContain('| KEEP _id |');
    });

    it('treats a missing alerts index as having no alerts', async () => {
      mockEsqlQuery.mockRejectedValue(
        Object.assign(new Error('verification_exception'), {
          statusCode: 400,
          body: {
            error: { type: 'verification_exception', reason: 'Unknown index [.alerts-security*]' },
          },
        })
      );

      const result = await filterHallucinatedAlerts(defaultProps);

      expect(result).toEqual([]);
    });
  });

  describe('when some alert IDs do not exist', () => {
    beforeEach(() => {
      mockEsqlQuery.mockResolvedValue(esqlIds('alert-1', 'alert-2', 'alert-3'));
    });

    it('returns only discoveries with all alert IDs present', async () => {
      const result = await filterHallucinatedAlerts(defaultProps);

      expect(result).toEqual([mockDiscovery1, mockDiscovery2]);
    });

    it('excludes discoveries with missing alert IDs', async () => {
      const result = await filterHallucinatedAlerts(defaultProps);

      expect(result).not.toContain(mockDiscovery3);
    });

    it('logs info message with count of filtered discoveries', async () => {
      await filterHallucinatedAlerts(defaultProps);

      expect(getInfoMessage()).toBe(
        'Attack discovery: Filtered out 1 discovery(ies) with hallucinated alert IDs'
      );
    });

    it('logs debug message for filtered discovery', async () => {
      await filterHallucinatedAlerts(defaultProps);

      expect(mockLogger.debug).toHaveBeenCalled();
      expect(getDebugMessage()).toContain('Discovery 3');
    });
  });

  describe('when a discovery has a partially missing alert ID', () => {
    beforeEach(() => {
      mockEsqlQuery.mockResolvedValue(esqlIds('alert-1', 'alert-2', 'alert-4', 'alert-5'));
    });

    it('filters out the discovery with the missing alert ID', async () => {
      const result = await filterHallucinatedAlerts(defaultProps);

      expect(result).toEqual([mockDiscovery1, mockDiscovery3]);
    });

    it('excludes the discovery from results', async () => {
      const result = await filterHallucinatedAlerts(defaultProps);

      expect(result).not.toContain(mockDiscovery2);
    });

    it('logs discovery title in debug message', async () => {
      await filterHallucinatedAlerts(defaultProps);

      expect(getDebugMessage()).toContain('Discovery 2');
    });

    it('logs hallucinated alert ID in debug message', async () => {
      await filterHallucinatedAlerts(defaultProps);

      expect(getDebugMessage()).toContain('alert-3');
    });
  });

  describe('when multiple discoveries have hallucinated alert IDs', () => {
    beforeEach(() => {
      mockEsqlQuery.mockResolvedValue(esqlIds('alert-2'));
    });

    it('logs information about filtered discoveries', async () => {
      await filterHallucinatedAlerts(defaultProps);

      expect(getInfoMessage()).toBe(
        'Attack discovery: Filtered out 3 discovery(ies) with hallucinated alert IDs'
      );
    });
  });

  describe('when all discoveries have hallucinated alert IDs', () => {
    beforeEach(() => {
      mockEsqlQuery.mockResolvedValue(esqlIds());
    });

    it('returns empty array', async () => {
      const result = await filterHallucinatedAlerts(defaultProps);

      expect(result).toEqual([]);
    });

    it('logs that all discoveries were filtered', async () => {
      await filterHallucinatedAlerts(defaultProps);

      expect(getInfoMessage()).toBe(
        'Attack discovery: Filtered out 3 discovery(ies) with hallucinated alert IDs'
      );
    });
  });

  describe('when discoveries have empty alertIds', () => {
    const mockDiscoveryEmpty: DiscoveryWithAlertIds = {
      alertIds: [],
      title: 'Empty Discovery',
    };

    beforeEach(() => {
      mockEsqlQuery.mockResolvedValue(esqlIds('alert-1', 'alert-2'));
    });

    it('filters out discoveries with empty alertIds', async () => {
      const result = await filterHallucinatedAlerts({
        ...defaultProps,
        attackDiscoveries: [mockDiscovery1, mockDiscoveryEmpty],
      });

      expect(result).toEqual([mockDiscovery1]);
    });

    it('logs unverifiable discoveries', async () => {
      await filterHallucinatedAlerts({
        ...defaultProps,
        attackDiscoveries: [mockDiscovery1, mockDiscoveryEmpty],
      });

      expect(getInfoMessage()).toContain('empty alertIds');
    });
  });

  describe('when using snake_case alert_ids field', () => {
    beforeEach(() => {
      mockEsqlQuery.mockResolvedValue(esqlIds('alert-6', 'alert-7'));
    });

    it('returns discoveries with snake_case alert_ids', async () => {
      const result = await filterHallucinatedAlerts({
        ...defaultProps,
        attackDiscoveries: [mockDiscoveryWithSnakeCase],
      });

      expect(result).toEqual([mockDiscoveryWithSnakeCase]);
    });

    it('queries ES with snake_case alert IDs', async () => {
      await filterHallucinatedAlerts({
        ...defaultProps,
        attackDiscoveries: [mockDiscoveryWithSnakeCase],
      });

      expect(getEsqlQuery()).toContain('WHERE _id IN ("alert-6", "alert-7")');
    });
  });

  describe('when ES returns null _id values', () => {
    beforeEach(() => {
      mockEsqlQuery.mockResolvedValue(esqlIds('alert-1', null, 'alert-2', null));
    });

    it('filters out null/undefined _id values', async () => {
      const result = await filterHallucinatedAlerts(defaultProps);

      expect(result).toEqual([mockDiscovery1]);
    });
  });
});
