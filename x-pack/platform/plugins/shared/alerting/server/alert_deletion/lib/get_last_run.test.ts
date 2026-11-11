/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggingSystemMock, securityServiceMock } from '@kbn/core/server/mocks';
import { eventLoggerMock } from '@kbn/event-log-plugin/server/mocks';
import { taskManagerMock } from '@kbn/task-manager-plugin/server/mocks';
import { AlertDeletionClient } from '../alert_deletion_client';
import { ruleTypeRegistryMock } from '../../rule_type_registry.mock';
import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import type { KibanaRequest } from '@kbn/core/server';
import type { SpacesServiceStart } from '@kbn/spaces-plugin/server/spaces_service';

const fakeRequest = {
  headers: {},
  getBasePath: () => '',
  path: '/',
  route: { settings: {} },
  url: {
    href: '/',
  },
  raw: {
    req: {
      url: '/',
    },
  },
  getSavedObjectsClient: jest.fn(),
} as unknown as KibanaRequest;

const auditService = securityServiceMock.createStart().audit;
const esClient = elasticsearchServiceMock.createClusterClient().asInternalUser;
const eventLogger = eventLoggerMock.create();
const getAlertIndicesAliasMock = jest.fn();
const logger: ReturnType<typeof loggingSystemMock.createLogger> = loggingSystemMock.createLogger();
const ruleTypeRegistry = ruleTypeRegistryMock.create();
const securityServiceStart = securityServiceMock.createStart();
const getSpaceId = jest.fn();
const spacesService = { getSpaceId } as unknown as SpacesServiceStart;
const taskManagerSetup = taskManagerMock.createSetup();
const taskManagerStart = taskManagerMock.createStart();

describe('getLastRun', () => {
  let alertDeletionClient: AlertDeletionClient;

  beforeEach(() => {
    jest.resetAllMocks();
    logger.get.mockImplementation(() => logger);
    getAlertIndicesAliasMock.mockReturnValue(['index1', 'index2']);
    // @ts-ignore - incomplete return type
    securityServiceStart.authc.getCurrentUser.mockReturnValue({ username: 'test_user' });
    alertDeletionClient = new AlertDeletionClient({
      auditService,
      elasticsearchClientPromise: Promise.resolve(esClient),
      eventLogger,
      getAlertIndicesAlias: getAlertIndicesAliasMock,
      logger,
      ruleTypeRegistry,
      securityService: Promise.resolve(securityServiceStart),
      spacesService: Promise.resolve(spacesService),
      taskManagerSetup,
      taskManagerStartPromise: Promise.resolve(taskManagerStart),
    });
  });

  const expectedQuery = (spaceId: string) => [
    {
      query:
        'FROM .kibana-event-log* | WHERE event.action == ?action AND event.provider == ?provider | SORT @timestamp DESC NULLS LAST | LIMIT 1 | KEEP @timestamp',
      params: [{ action: 'delete-alerts' }, { provider: 'alerting' }],
      filter: { term: { 'kibana.space_ids': spaceId } },
    },
    expect.anything(),
  ];

  test('should return last run time if available', async () => {
    getSpaceId.mockReturnValueOnce('space1');
    esClient.esql.query.mockResolvedValueOnce({
      columns: [{ name: '@timestamp', type: 'date' }],
      values: [['2025-03-25T15:20:44.704Z']],
    });

    const lastRunDate = await alertDeletionClient.getLastRun(fakeRequest);

    expect(esClient.esql.query).toHaveBeenCalledWith(...expectedQuery('space1'));
    expect(lastRunDate).toEqual('2025-03-25T15:20:44.704Z');
  });

  test('should return undefined if not available', async () => {
    getSpaceId.mockReturnValueOnce('default');
    esClient.esql.query.mockResolvedValueOnce({
      columns: [{ name: '@timestamp', type: 'date' }],
      values: [],
    });

    const lastRunDate = await alertDeletionClient.getLastRun(fakeRequest);

    expect(esClient.esql.query).toHaveBeenCalledWith(...expectedQuery('default'));
    expect(lastRunDate).toBeUndefined();
  });

  test('logs and returns undefined if search errors', async () => {
    getSpaceId.mockReturnValueOnce('default');
    esClient.esql.query.mockImplementationOnce(() => {
      throw new Error('search failed');
    });

    await alertDeletionClient.getLastRun(fakeRequest);

    expect(esClient.esql.query).toHaveBeenCalledWith(...expectedQuery('default'));
    expect(logger.error).toHaveBeenCalledWith('Error getting last run date: search failed');
  });
});
