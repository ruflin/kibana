/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import { getAlertSnoozeSnapshot } from './get_alert_snooze_snapshot';

const sourceResponse = (source?: Record<string, unknown>) =>
  ({
    columns: [{ name: '_source', type: 'unsupported' }],
    values: source ? [[source]] : [],
  } as never);

describe('getAlertSnoozeSnapshot', () => {
  test('searches with the correct params using _source filtering', async () => {
    const logger = loggingSystemMock.createLogger();
    const clusterClient = elasticsearchServiceMock.createClusterClient().asInternalUser;

    clusterClient.esql.query.mockResolvedValueOnce(sourceResponse());

    await getAlertSnoozeSnapshot({
      logger,
      esClient: clusterClient,
      indices: ['test-index'],
      alertId: 'test-alert-id',
      ruleId: 'test-rule-id',
      fields: ['host.name', 'kibana.alert.severity'],
    });

    expect(clusterClient.esql.query).toHaveBeenCalledWith(
      {
        query:
          'FROM test-index METADATA _source | WHERE kibana.alert.rule.uuid == ?ruleId AND kibana.alert.status == ?status AND kibana.alert.instance.id == ?alertId | LIMIT 1',
        params: [{ ruleId: 'test-rule-id' }, { status: 'active' }, { alertId: 'test-alert-id' }],
      },
      expect.anything()
    );
  });

  test('returns snapshot values from _source in their original stored form', async () => {
    const logger = loggingSystemMock.createLogger();
    const clusterClient = elasticsearchServiceMock.createClusterClient().asInternalUser;

    clusterClient.esql.query.mockResolvedValueOnce(
      sourceResponse({
        'host.name': 'web-01',
        'kibana.alert.severity': 'high',
      })
    );

    const result = await getAlertSnoozeSnapshot({
      logger,
      esClient: clusterClient,
      indices: ['test-index'],
      alertId: 'test-alert-id',
      ruleId: 'test-rule-id',
      fields: ['host.name', 'kibana.alert.severity'],
    });

    expect(result).toEqual({
      'host.name': 'web-01',
      'kibana.alert.severity': 'high',
    });
  });

  test('preserves array values without unwrapping (e.g. kibana.alert.rule.tags)', async () => {
    const logger = loggingSystemMock.createLogger();
    const clusterClient = elasticsearchServiceMock.createClusterClient().asInternalUser;

    clusterClient.esql.query.mockResolvedValueOnce(
      sourceResponse({
        // Stored as a single-element array — must NOT be unwrapped to scalar
        'kibana.alert.rule.tags': ['web'],
      })
    );

    const result = await getAlertSnoozeSnapshot({
      logger,
      esClient: clusterClient,
      indices: ['test-index'],
      alertId: 'test-alert-id',
      ruleId: 'test-rule-id',
      fields: ['kibana.alert.rule.tags'],
    });

    // Must stay as array to match what AlertBuilder produces in-memory
    expect(result).toEqual({ 'kibana.alert.rule.tags': ['web'] });
  });

  test('preserves object fields with nested arrays (e.g. kibana.alert.rule.parameters)', async () => {
    const logger = loggingSystemMock.createLogger();
    const clusterClient = elasticsearchServiceMock.createClusterClient().asInternalUser;

    const params = { threshold: [1], size: 100, aggType: 'count' };

    clusterClient.esql.query.mockResolvedValueOnce(
      sourceResponse({
        // Object field stored exactly as the alert builder produced it
        'kibana.alert.rule.parameters': params,
      })
    );

    const result = await getAlertSnoozeSnapshot({
      logger,
      esClient: clusterClient,
      indices: ['test-index'],
      alertId: 'test-alert-id',
      ruleId: 'test-rule-id',
      fields: ['kibana.alert.rule.parameters'],
    });

    // Must preserve {threshold: [1]} — not normalize to {threshold: 1}
    expect(result).toEqual({ 'kibana.alert.rule.parameters': params });
  });

  test('returns null when the alert does not exist', async () => {
    const logger = loggingSystemMock.createLogger();
    const clusterClient = elasticsearchServiceMock.createClusterClient().asInternalUser;

    clusterClient.esql.query.mockResolvedValueOnce(sourceResponse());

    const result = await getAlertSnoozeSnapshot({
      logger,
      esClient: clusterClient,
      indices: ['test-index'],
      alertId: 'test-alert-id',
      ruleId: 'test-rule-id',
      fields: ['host.name'],
    });

    expect(result).toBeNull();
  });

  test('stores missing requested fields as null', async () => {
    const logger = loggingSystemMock.createLogger();
    const clusterClient = elasticsearchServiceMock.createClusterClient().asInternalUser;

    clusterClient.esql.query.mockResolvedValueOnce(
      sourceResponse({
        // kibana.alert.severity not present
        'host.name': 'web-01',
      })
    );

    const result = await getAlertSnoozeSnapshot({
      logger,
      esClient: clusterClient,
      indices: ['test-index'],
      alertId: 'test-alert-id',
      ruleId: 'test-rule-id',
      fields: ['host.name', 'kibana.alert.severity'],
    });

    expect(result).toEqual({
      'host.name': 'web-01',
      'kibana.alert.severity': null,
    });
  });

  test('logs an error when search fails with an Error instance', async () => {
    const logger = loggingSystemMock.createLogger();
    const clusterClient = elasticsearchServiceMock.createClusterClient().asInternalUser;

    clusterClient.esql.query.mockRejectedValueOnce(new Error('Test error'));

    const result = await getAlertSnoozeSnapshot({
      logger,
      esClient: clusterClient,
      indices: ['test-index'],
      alertId: 'test-alert-id',
      ruleId: 'test-rule-id',
      fields: ['host.name'],
    });

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      'Error fetching snooze snapshot for alertId: test-alert-id and ruleId: test-rule-id - Test error'
    );
  });

  test('logs an error when search fails with a non-Error thrown value', async () => {
    const logger = loggingSystemMock.createLogger();
    const clusterClient = elasticsearchServiceMock.createClusterClient().asInternalUser;

    clusterClient.esql.query.mockRejectedValueOnce('unexpected string error');

    const result = await getAlertSnoozeSnapshot({
      logger,
      esClient: clusterClient,
      indices: ['test-index'],
      alertId: 'test-alert-id',
      ruleId: 'test-rule-id',
      fields: ['host.name'],
    });

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      'Error fetching snooze snapshot for alertId: test-alert-id and ruleId: test-rule-id - unexpected string error'
    );
  });
});
