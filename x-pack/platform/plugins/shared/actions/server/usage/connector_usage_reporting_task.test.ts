/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import fs from 'fs';
import axios from 'axios';
import { loggingSystemMock } from '@kbn/core/server/mocks';
import { coreMock } from '@kbn/core/server/mocks';
import type { ElasticsearchClientMock } from '@kbn/core/server/mocks';
import type {
  TaskManagerSetupContract,
  TaskManagerStartContract,
} from '@kbn/task-manager-plugin/server';
import { TaskStatus } from '@kbn/task-manager-plugin/server';
import { taskManagerMock } from '@kbn/task-manager-plugin/server/mocks';
import {
  CONNECTOR_USAGE_REPORTING_SOURCE_ID,
  CONNECTOR_USAGE_REPORTING_TASK_ID,
  CONNECTOR_USAGE_REPORTING_TASK_SCHEDULE,
  CONNECTOR_USAGE_REPORTING_TASK_TYPE,
  ConnectorUsageReportingTask,
} from './connector_usage_reporting_task';
import type { CoreSetup, ElasticsearchClient } from '@kbn/core/server';
import type { ActionsPluginsStart } from '../plugin';

jest.mock('axios');
const mockedAxiosPost = jest.spyOn(axios, 'post');

const nowStr = '2024-01-01T12:00:00.000Z';
const nowDate = new Date(nowStr);

jest.useFakeTimers();
jest.setSystemTime(nowDate.getTime());
const readFileSpy = jest.spyOn(fs, 'readFileSync');

describe('ConnectorUsageReportingTask', () => {
  const logger = loggingSystemMock.createLogger();
  const { createSetup } = coreMock;
  const { createSetup: taskManagerSetupMock, createStart: taskManagerStartMock } = taskManagerMock;
  let mockEsClient: ElasticsearchClientMock;
  let mockCore: CoreSetup<ActionsPluginsStart>;
  let mockTaskManagerSetup: jest.Mocked<TaskManagerSetupContract>;
  let mockTaskManagerStart: jest.Mocked<TaskManagerStartContract>;

  beforeEach(async () => {
    mockTaskManagerSetup = taskManagerSetupMock();
    mockTaskManagerStart = taskManagerStartMock();
    mockCore = createSetup();
    mockEsClient = (await mockCore.getStartServices())[0].elasticsearch.client
      .asInternalUser as ElasticsearchClientMock;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const createTaskRunner = async ({
    lastReportedUsageDate,
    projectId,
    attempts = 0,
    enabled = true,
    url,
  }: {
    lastReportedUsageDate: Date;
    projectId?: string;
    attempts?: number;
    enabled?: boolean;
    url?: string;
  }) => {
    const timestamp = new Date(new Date().setMinutes(-15));
    const task = new ConnectorUsageReportingTask({
      eventLogIndex: 'test-index',
      projectId,
      logger,
      core: mockCore,
      taskManager: mockTaskManagerSetup,
      config: {
        enabled,
        url,
        ca: {
          path: './ca.crt',
        },
      },
    });

    await task.start(mockTaskManagerStart);

    const createTaskRunnerFunction =
      mockTaskManagerSetup.registerTaskDefinitions.mock.calls[0][0][
        CONNECTOR_USAGE_REPORTING_TASK_TYPE
      ].createTaskRunner;

    return createTaskRunnerFunction(
      taskManagerMock.createRunContext({
        taskInstance: {
          id: CONNECTOR_USAGE_REPORTING_TASK_ID,
          runAt: timestamp,
          attempts: 0,
          ownerId: '',
          status: TaskStatus.Running,
          startedAt: timestamp,
          scheduledAt: timestamp,
          retryAt: null,
          params: {},
          state: {
            lastReportedUsageDate,
            attempts,
          },
          taskType: CONNECTOR_USAGE_REPORTING_TASK_TYPE,
        },
      })
    );
  };

  it('registers the task', async () => {
    readFileSpy.mockImplementationOnce(() => '---CA CERTIFICATE---');
    new ConnectorUsageReportingTask({
      eventLogIndex: 'test-index',
      projectId: 'test-projecr',
      logger,
      core: createSetup(),
      taskManager: mockTaskManagerSetup,
      config: {
        enabled: true,
        url: 'usage-api',
        ca: {
          path: './ca.crt',
        },
      },
    });

    expect(mockTaskManagerSetup.registerTaskDefinitions).toHaveBeenCalledTimes(1);
    expect(mockTaskManagerSetup.registerTaskDefinitions).toHaveBeenCalledWith({
      [CONNECTOR_USAGE_REPORTING_TASK_TYPE]: {
        title: 'Connector usage reporting task',
        timeout: '1m',
        createTaskRunner: expect.any(Function),
      },
    });
  });

  it('schedules the task', async () => {
    readFileSpy.mockImplementationOnce(() => '---CA CERTIFICATE---');
    const core = createSetup();
    const taskManagerStart = taskManagerStartMock();

    const task = new ConnectorUsageReportingTask({
      eventLogIndex: 'test-index',
      projectId: 'test-projecr',
      logger,
      core,
      taskManager: mockTaskManagerSetup,
      config: {
        enabled: true,
        url: 'usage-api',
        ca: {
          path: './ca.crt',
        },
      },
    });

    await task.start(taskManagerStart);

    expect(taskManagerStart.ensureScheduled).toHaveBeenCalledTimes(1);
    expect(taskManagerStart.ensureScheduled).toHaveBeenCalledWith({
      id: CONNECTOR_USAGE_REPORTING_TASK_ID,
      taskType: CONNECTOR_USAGE_REPORTING_TASK_TYPE,
      schedule: {
        ...CONNECTOR_USAGE_REPORTING_TASK_SCHEDULE,
      },
      state: {},
      params: {},
    });
  });

  it('logs error if task manager is not ready', async () => {
    readFileSpy.mockImplementationOnce(() => '---CA CERTIFICATE---');
    const core = createSetup();
    const taskManagerStart = taskManagerStartMock();

    const task = new ConnectorUsageReportingTask({
      eventLogIndex: 'test-index',
      projectId: 'test-projecr',
      logger,
      core,
      taskManager: mockTaskManagerSetup,
      config: {
        enabled: true,
        url: 'usage-api',
        ca: {
          path: './ca.crt',
        },
      },
    });

    await task.start();

    expect(taskManagerStart.ensureScheduled).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      `Missing required task manager service during start of ${CONNECTOR_USAGE_REPORTING_TASK_TYPE}`
    );
  });

  it('logs error if scheduling task fails', async () => {
    readFileSpy.mockImplementationOnce(() => '---CA CERTIFICATE---');
    const core = createSetup();
    const taskManagerStart = taskManagerStartMock();
    taskManagerStart.ensureScheduled.mockRejectedValue(new Error('test'));

    const task = new ConnectorUsageReportingTask({
      eventLogIndex: 'test-index',
      projectId: 'test-projecr',
      logger,
      core,
      taskManager: mockTaskManagerSetup,
      config: {
        enabled: true,
        url: 'usage-api',
        ca: {
          path: './ca.crt',
        },
      },
    });

    await task.start(taskManagerStart);

    expect(logger.error).toHaveBeenCalledWith(
      'Error scheduling task actions:connector_usage_reporting, received test'
    );
  });

  it('returns the existing state and logs a warning when project id is missing', async () => {
    const lastReportedUsageDateStr = '2024-01-01T00:00:00.000Z';
    const lastReportedUsageDate = new Date(lastReportedUsageDateStr);

    const taskRunner = await createTaskRunner({ lastReportedUsageDate });

    const response = await taskRunner.run();

    expect(logger.warn).toHaveBeenCalledWith(
      'Missing required project id while running actions:connector_usage_reporting, reporting task will be deleted'
    );

    expect(response).toEqual({
      shouldDeleteTask: true,
      state: {
        attempts: 0,
        lastReportedUsageDate,
      },
    });
  });

  it('returns the existing state and logs an error when the CA Certificate is missing', async () => {
    const lastReportedUsageDateStr = '2024-01-01T00:00:00.000Z';
    const lastReportedUsageDate = new Date(lastReportedUsageDateStr);
    readFileSpy.mockImplementationOnce((func) => {
      throw new Error('Mock file read error.');
    });

    const taskRunner = await createTaskRunner({ lastReportedUsageDate, projectId: 'test-id' });

    const response = await taskRunner.run();

    expect(logger.error).toHaveBeenCalledTimes(2);

    expect(logger.error).toHaveBeenNthCalledWith(
      1,
      `CA Certificate for the project "test-id" couldn't be loaded, Error: Mock file read error.`
    );

    expect(logger.error).toHaveBeenNthCalledWith(
      2,
      'Missing required CA Certificate while running actions:connector_usage_reporting'
    );

    expect(response).toEqual({
      state: {
        attempts: 0,
        lastReportedUsageDate,
      },
    });
  });

  it('returns the existing state and logs a warning when the usage API is disabled', async () => {
    const lastReportedUsageDateStr = '2024-01-01T00:00:00.000Z';
    const lastReportedUsageDate = new Date(lastReportedUsageDateStr);

    const taskRunner = await createTaskRunner({
      lastReportedUsageDate,
      projectId: 'test-id',
      enabled: false,
    });

    const response = await taskRunner.run();

    expect(logger.warn).toHaveBeenCalledTimes(1);

    expect(logger.warn).toHaveBeenCalledWith(
      'Usage API is disabled, actions:connector_usage_reporting will be skipped'
    );

    expect(response).toEqual({
      state: {
        attempts: 0,
        lastReportedUsageDate,
      },
    });
  });

  it('returns the existing state and logs a warning when the usage API url is not defined', async () => {
    readFileSpy.mockImplementationOnce(() => '---CA CERTIFICATE---');
    const lastReportedUsageDateStr = '2024-01-01T00:00:00.000Z';
    const lastReportedUsageDate = new Date(lastReportedUsageDateStr);

    const taskRunner = await createTaskRunner({
      lastReportedUsageDate,
      projectId: 'test-id',
    });

    const response = await taskRunner.run();

    expect(logger.error).toHaveBeenCalledTimes(1);

    expect(logger.error).toHaveBeenCalledWith(
      'Missing required Usage API url while running actions:connector_usage_reporting'
    );

    expect(response).toEqual({
      state: {
        attempts: 0,
        lastReportedUsageDate,
      },
    });
  });

  it('runs the task', async () => {
    readFileSpy.mockImplementationOnce(() => '---CA CERTIFICATE---');
    mockEsClient.esql.query.mockResolvedValueOnce({
      columns: [{ name: 'total_usage', type: 'double' }],
      values: [[215]],
    } as unknown as Awaited<ReturnType<ElasticsearchClient['esql']['query']>>);

    mockedAxiosPost.mockResolvedValueOnce(200);

    const lastReportedUsageDateStr = '2024-01-01T00:00:00.000Z';
    const lastReportedUsageDate = new Date(lastReportedUsageDateStr);

    const taskRunner = await createTaskRunner({
      lastReportedUsageDate,
      projectId: 'test-project',
      url: 'usage-api',
    });

    const response = await taskRunner.run();

    const report = [
      {
        creation_timestamp: nowStr,
        id: 'connector-request-body-bytes-test-project-2024-01-01T12:00:00.000Z',
        source: {
          id: CONNECTOR_USAGE_REPORTING_SOURCE_ID,
          instance_group_id: 'test-project',
        },
        usage: {
          period_seconds: 43200,
          quantity: 215,
          type: 'connector_request_body_bytes',
        },
        usage_timestamp: nowStr,
      },
    ];

    expect(mockedAxiosPost).toHaveBeenCalledWith('usage-api', report, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
      httpsAgent: expect.any(Object),
    });

    expect(response).toEqual({
      state: {
        attempts: 0,
        lastReportedUsageDate: expect.any(Date),
      },
    });
  });

  it('sums the request body bytes of the connector executions in the reporting window', async () => {
    readFileSpy.mockImplementationOnce(() => '---CA CERTIFICATE---');
    mockEsClient.esql.query.mockResolvedValueOnce({
      columns: [{ name: 'total_usage', type: 'double' }],
      values: [[215]],
    } as unknown as Awaited<ReturnType<ElasticsearchClient['esql']['query']>>);
    mockedAxiosPost.mockResolvedValueOnce(200);

    const lastReportedUsageDate = new Date('2024-01-01T00:00:00.000Z');
    const taskRunner = await createTaskRunner({
      lastReportedUsageDate,
      projectId: 'test-project',
      url: 'usage-api',
    });
    await taskRunner.run();

    const [request] = mockEsClient.esql.query.mock.calls[0];
    expect(request).toEqual({
      query:
        'FROM test-index | WHERE event.action == "execute" AND event.provider == "actions" AND kibana.action.execution.usage.request_body_bytes IS NOT NULL AND @timestamp > TO_DATETIME(?fromDate) AND @timestamp <= TO_DATETIME(?toDate) | STATS total_usage = SUM(TO_DOUBLE(kibana.action.execution.usage.request_body_bytes))',
      params: [{ fromDate: '2024-01-01T00:00:00.000Z' }, { toDate: nowStr }],
    });
  });

  it('reports no usage when no event log index exists yet', async () => {
    readFileSpy.mockImplementationOnce(() => '---CA CERTIFICATE---');
    mockEsClient.esql.query.mockRejectedValueOnce(
      Object.assign(new Error('verification_exception'), {
        statusCode: 400,
        body: {
          error: { type: 'verification_exception', reason: 'Found 1 problem\nUnknown index [x]' },
        },
      })
    );
    mockedAxiosPost.mockResolvedValueOnce(200);

    const taskRunner = await createTaskRunner({
      lastReportedUsageDate: new Date('2024-01-01T00:00:00.000Z'),
      projectId: 'test-project',
      url: 'usage-api',
    });
    await taskRunner.run();

    expect(mockedAxiosPost).toHaveBeenCalledWith(
      'usage-api',
      [expect.objectContaining({ usage: expect.objectContaining({ quantity: 0 }) })],
      expect.anything()
    );
  });

  it('re-runs the task when search for records fails', async () => {
    readFileSpy.mockImplementationOnce(() => '---CA CERTIFICATE---');
    mockEsClient.esql.query.mockRejectedValue(new Error('500'));

    mockedAxiosPost.mockResolvedValueOnce(200);

    const lastReportedUsageDate = new Date('2024-01-01T00:00:00.000Z');

    const taskRunner = await createTaskRunner({
      lastReportedUsageDate,
      projectId: 'test-project',
      url: 'usage-api',
    });

    const response = await taskRunner.run();

    expect(response).toEqual({
      state: {
        lastReportedUsageDate,
        attempts: 0,
      },
      runAt: nowDate,
    });
  });

  it('re-runs the task when it fails to push the usage record', async () => {
    readFileSpy.mockImplementationOnce(() => '---CA CERTIFICATE---');
    mockEsClient.esql.query.mockResolvedValueOnce({
      columns: [{ name: 'total_usage', type: 'double' }],
      values: [[215]],
    } as unknown as Awaited<ReturnType<ElasticsearchClient['esql']['query']>>);

    mockedAxiosPost.mockRejectedValueOnce(500);

    const lastReportedUsageDate = new Date('2024-01-01T00:00:00.000Z');

    const taskRunner = await createTaskRunner({
      lastReportedUsageDate,
      projectId: 'test-project',
      url: 'usage-api',
    });

    const response = await taskRunner.run();

    expect(response).toEqual({
      state: {
        lastReportedUsageDate,
        attempts: 1,
      },
      runAt: new Date(nowDate.getTime() + 60000), // After a min
    });
  });

  it('stops retrying after 5 attempts', async () => {
    readFileSpy.mockImplementationOnce(() => '---CA CERTIFICATE---');
    mockEsClient.esql.query.mockResolvedValueOnce({
      columns: [{ name: 'total_usage', type: 'double' }],
      values: [[215]],
    } as unknown as Awaited<ReturnType<ElasticsearchClient['esql']['query']>>);

    mockedAxiosPost.mockRejectedValueOnce(new Error('test-error'));

    const lastReportedUsageDate = new Date('2024-01-01T00:00:00.000Z');

    const taskRunner = await createTaskRunner({
      lastReportedUsageDate,
      projectId: 'test-project',
      attempts: 4,
      url: 'usage-api',
    });

    const response = await taskRunner.run();

    expect(response).toEqual({
      state: {
        lastReportedUsageDate,
        attempts: 0,
      },
    });

    expect(logger.error).toHaveBeenCalledWith(
      'Usage data could not be pushed to usage-api. Stopped retrying after 5 attempts. Error:test-error'
    );
  });

  it('does not schedule the task when the project id is missing', async () => {
    const core = createSetup();
    const taskManagerStart = taskManagerStartMock();

    const task = new ConnectorUsageReportingTask({
      eventLogIndex: 'test-index',
      projectId: undefined,
      logger,
      core,
      taskManager: mockTaskManagerSetup,
      config: {
        url: 'usage-api',
        ca: {
          path: './ca.crt',
        },
      },
    });

    await task.start(taskManagerStart);

    expect(taskManagerStart.ensureScheduled).not.toHaveBeenCalled();
  });
});
