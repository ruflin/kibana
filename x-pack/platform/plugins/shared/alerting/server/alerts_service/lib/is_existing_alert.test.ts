/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { isExistingAlert } from './is_existing_alert';
import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';

describe('isExistingAlert', () => {
  test('searches with the correct params', async () => {
    const logger = loggingSystemMock.createLogger();
    const clusterClient = elasticsearchServiceMock.createClusterClient().asInternalUser;
    clusterClient.esql.query.mockResolvedValueOnce({ columns: [], values: [] });

    await isExistingAlert({
      logger,
      esClient: clusterClient,
      indices: ['test-index'],
      alertId: 'test-alert-id',
      ruleId: 'test-rule-id',
    });

    expect(clusterClient.esql.query).toHaveBeenCalledWith(
      {
        query:
          'FROM test-index | WHERE kibana.alert.rule.uuid == ?ruleId AND kibana.alert.instance.id == ?alertId | LIMIT 1',
        params: [{ ruleId: 'test-rule-id' }, { alertId: 'test-alert-id' }],
      },
      expect.anything()
    );
  });

  test('returns true is the alert exists', async () => {
    const logger = loggingSystemMock.createLogger();
    const clusterClient = elasticsearchServiceMock.createClusterClient().asInternalUser;

    clusterClient.esql.query.mockResolvedValueOnce({
      columns: [{ name: '_index', type: 'keyword' }],
      values: [['test-index']],
    });

    const result = await isExistingAlert({
      logger,
      esClient: clusterClient,
      indices: ['test-index'],
      alertId: 'test-alert-id',
      ruleId: 'test-rule-id',
    });

    expect(result).toBe(true);
  });

  test('returns false is the alert does not exist', async () => {
    const logger = loggingSystemMock.createLogger();
    const clusterClient = elasticsearchServiceMock.createClusterClient().asInternalUser;

    clusterClient.esql.query.mockResolvedValueOnce({ columns: [], values: [] });

    const result = await isExistingAlert({
      logger,
      esClient: clusterClient,
      indices: ['test-index'],
      alertId: 'test-alert-id',
      ruleId: 'test-rule-id',
    });

    expect(result).toBe(false);
  });

  test('logs an error when search fails', async () => {
    const logger = loggingSystemMock.createLogger();
    const clusterClient = elasticsearchServiceMock.createClusterClient().asInternalUser;

    clusterClient.esql.query.mockRejectedValueOnce(new Error('Test error'));

    const result = await isExistingAlert({
      logger,
      esClient: clusterClient,
      indices: ['test-index'],
      alertId: 'test-alert-id',
      ruleId: 'test-rule-id',
    });

    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      'Error checking for existing alert with alertId: test-alert-id and ruleId: test-rule-id - Test error'
    );
  });
});
