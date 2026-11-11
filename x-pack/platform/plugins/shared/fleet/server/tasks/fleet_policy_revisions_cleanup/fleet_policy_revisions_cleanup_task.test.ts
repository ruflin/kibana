/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { taskManagerMock } from '@kbn/task-manager-plugin/server/mocks';
import { loggerMock } from '@kbn/logging-mocks';
import { coreMock } from '@kbn/core/server/mocks';
import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import type { ConcreteTaskInstance } from '@kbn/task-manager-plugin/server';

import { appContextService } from '../../services';

import {
  FleetPolicyRevisionsCleanupTask,
  TYPE,
  VERSION,
} from './fleet_policy_revisions_cleanup_task';
import { sweepOrphanedFleetPolicies } from './sweep_orphaned_fleet_policies';

jest.mock('../../services');
// Mock the orphan sweep so that existing revision-cleanup tests are unaffected.
// Dedicated tests for the sweep logic live in sweep_orphaned_fleet_policies.test.ts.
jest.mock('./sweep_orphaned_fleet_policies');

const mockedSweepOrphanedFleetPolicies = sweepOrphanedFleetPolicies as jest.MockedFunction<
  typeof sweepOrphanedFleetPolicies
>;

const mockAppContextService = appContextService as jest.Mocked<typeof appContextService>;

const expectedDeleteByQueryConfig = {
  conflicts: 'proceed',
  max_docs: expect.any(Number),
  scroll: expect.any(String),
  scroll_size: expect.any(Number),
  wait_for_completion: true,
};

const latestRevisionsResponse = (rows: Array<[string, number, number]>) =>
  ({
    columns: [
      { name: 'policy_id', type: 'keyword' },
      { name: 'doc_count', type: 'long' },
      { name: 'latest_revision', type: 'integer' },
    ],
    values: rows,
  } as any);

const minUsedResponse = (rows: Array<[string, number]>) =>
  ({
    columns: [
      { name: 'policy_id', type: 'keyword' },
      { name: 'min_used_revision', type: 'integer' },
    ],
    values: rows,
  } as any);

describe('FleetPolicyRevisionsCleanupTask', () => {
  let mockTask: FleetPolicyRevisionsCleanupTask;
  let mockCore: ReturnType<typeof coreMock.createSetup>;
  let mockCoreStart: ReturnType<typeof coreMock.createStart>;
  let mockTaskManager: ReturnType<typeof taskManagerMock.createSetup>;
  let mockTaskManagerStart: ReturnType<typeof taskManagerMock.createStart>;
  let logFactory: ReturnType<typeof loggerMock.create>;
  let logger: ReturnType<typeof loggerMock.create>;
  let mockEsClient: ReturnType<typeof elasticsearchServiceMock.createElasticsearchClient>;
  let signal: AbortSignal;
  let taskInstance: ConcreteTaskInstance;

  const defaultConfig = {
    maxRevisions: 10,
    interval: '1h',
    maxPoliciesPerRun: 100,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockCore = coreMock.createSetup();
    mockCoreStart = coreMock.createStart();
    mockTaskManager = taskManagerMock.createSetup();
    mockTaskManagerStart = taskManagerMock.createStart();
    logFactory = loggerMock.create();
    logger = loggerMock.create();
    mockEsClient = elasticsearchServiceMock.createElasticsearchClient();
    signal = new AbortController().signal;

    // Setup core services mock
    mockCore.getStartServices.mockResolvedValue([mockCoreStart, {}, {}] as any);
    Object.defineProperty(mockCoreStart.elasticsearch.client, 'asInternalUser', {
      value: mockEsClient,
      writable: true,
    });

    logFactory.get.mockReturnValue(logger);

    // Setup app context service mocks
    mockAppContextService.getExperimentalFeatures.mockReturnValue({
      enableFleetPolicyRevisionsCleanupTask: true,
      enableFleetOrphanedPolicySweep: true,
    } as any);

    // Default: orphan sweep finds nothing to delete
    mockedSweepOrphanedFleetPolicies.mockResolvedValue({ deletedCount: 0 });

    taskInstance = {
      id: `${TYPE}:${VERSION}`,
      taskType: TYPE,
      scheduledAt: new Date(),
      attempts: 0,
      status: 'idle' as any,
      runAt: new Date(),
      state: {},
      params: { version: VERSION },
      ownerId: null,
      startedAt: null,
      retryAt: null,
    };

    mockTask = new FleetPolicyRevisionsCleanupTask({
      core: mockCore,
      taskManager: mockTaskManager,
      logFactory,
      config: defaultConfig,
    });
  });

  describe('constructor and setup', () => {
    it('should register task definition with correct parameters', () => {
      expect(mockTaskManager.registerTaskDefinitions).toHaveBeenCalledWith({
        [TYPE]: expect.objectContaining({
          title: 'Fleet Policy Revisions Cleanup Task',
          timeout: '5m',
          createTaskRunner: expect.any(Function),
        }),
      });
    });

    it('should use provided configuration values', () => {
      const customConfig = {
        maxRevisions: 20,
        interval: '2h',
        maxPoliciesPerRun: 50,
      };

      const task = new FleetPolicyRevisionsCleanupTask({
        core: mockCore,
        taskManager: mockTaskManager,
        logFactory,
        config: customConfig,
      });

      expect(task).toBeDefined();
    });

    it('should use default configuration values when not provided', () => {
      const task = new FleetPolicyRevisionsCleanupTask({
        core: mockCore,
        taskManager: mockTaskManager,
        logFactory,
        config: {},
      });

      expect(task).toBeDefined();
    });
  });

  describe('start', () => {
    it('should successfully start and schedule task', async () => {
      await mockTask.start({ taskManager: mockTaskManagerStart });

      expect(mockTaskManagerStart.ensureScheduled).toHaveBeenCalledWith({
        id: `${TYPE}:${VERSION}`,
        taskType: TYPE,
        scope: ['fleet'],
        schedule: {
          interval: '1h',
        },
        state: {},
        params: { version: VERSION },
      });

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          'Started with interval of [1h], max_revisions: 10, max_policies_per_run: 100'
        )
      );
    });

    it('should handle scheduling errors', async () => {
      const error = new Error('Scheduling failed');
      mockTaskManagerStart.ensureScheduled.mockRejectedValue(error);

      await mockTask.start({ taskManager: mockTaskManagerStart });

      expect(logger.error).toHaveBeenCalledWith(
        'Error scheduling task FleetPolicyRevisionsCleanupTask, error: Scheduling failed',
        error
      );
    });
  });

  describe('runTask', () => {
    beforeEach(async () => {
      await mockTask.start({ taskManager: mockTaskManagerStart });
    });

    it('should skip execution when feature flag is disabled', async () => {
      mockAppContextService.getExperimentalFeatures.mockReturnValue({
        enableFleetPolicyRevisionsCleanupTask: false,
      } as any);

      await mockTask.runTask(taskInstance, mockCore, signal);

      expect(logger.debug).toHaveBeenCalledWith(
        '[FleetPolicyRevisionsCleanupTask] Aborting runTask: fleet policy revision cleanup task feature is disabled'
      );
      expect(mockCore.getStartServices).not.toHaveBeenCalled();
    });

    it('should log errors if one is thrown', async () => {
      const error = new Error('Test error');
      mockEsClient.esql.query.mockRejectedValue(error);

      await mockTask.runTask(taskInstance, mockCore, signal);

      expect(logger.error).toHaveBeenCalledWith(
        '[FleetPolicyRevisionsCleanupTask] error: Error: Test error'
      );
    });
  });

  describe('cleanupPolicyRevisions', () => {
    beforeEach(async () => {
      await mockTask.start({ taskManager: mockTaskManagerStart });
    });

    it('should exit early when no policies need cleanup', async () => {
      mockEsClient.esql.query.mockResolvedValue(latestRevisionsResponse([]));

      await mockTask.runTask(taskInstance, mockCore, signal);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('No policies found with more than 10 revisions')
      );
      expect(mockEsClient.esql.query).toHaveBeenCalledTimes(1);
    });

    it('should process policies that exceed max revisions', async () => {
      mockEsClient.esql.query
        .mockResolvedValueOnce(
          latestRevisionsResponse([
            ['policy-1', 15, 15],
            ['policy-2', 5, 5],
          ])
        )
        .mockResolvedValueOnce(minUsedResponse([['policy-1', 15]]));

      mockEsClient.deleteByQuery.mockResolvedValue({
        deleted: 5,
      } as any);

      await mockTask.runTask(taskInstance, mockCore, signal);

      expect(logger.info).toHaveBeenCalledWith(
        '[FleetPolicyRevisionsCleanupTask] Found 1 policies with more than 10 revisions.'
      );
      expect(mockEsClient.deleteByQuery).toHaveBeenCalledWith(
        {
          index: '.fleet-policies',
          ...expectedDeleteByQueryConfig,
          query: {
            bool: {
              should: [
                {
                  bool: {
                    must: [
                      { term: { policy_id: 'policy-1' } },
                      { range: { revision_idx: { lte: 5 } } }, // 15 - 10 = 5
                    ],
                  },
                },
              ],
            },
          },
        },
        {
          signal,
        }
      );
    });

    it('should favor cutting off deletions from the minimum used revision', async () => {
      mockEsClient.esql.query
        .mockResolvedValueOnce(
          latestRevisionsResponse([
            ['policy-1', 15, 15],
            ['policy-2', 5, 5],
          ])
        )
        .mockResolvedValueOnce(minUsedResponse([['policy-1', 12]]));

      mockEsClient.deleteByQuery.mockResolvedValue({
        deleted: 5,
      } as any);

      await mockTask.runTask(taskInstance, mockCore, signal);

      expect(logger.info).toHaveBeenCalledWith(
        '[FleetPolicyRevisionsCleanupTask] Found 1 policies with more than 10 revisions.'
      );
      expect(mockEsClient.deleteByQuery).toHaveBeenCalledWith(
        {
          index: '.fleet-policies',
          ...expectedDeleteByQueryConfig,
          query: {
            bool: {
              should: [
                {
                  bool: {
                    must: [
                      { term: { policy_id: 'policy-1' } },
                      { range: { revision_idx: { lte: 2 } } }, // 12 - 10 = 2
                    ],
                  },
                },
              ],
            },
          },
        },
        {
          signal,
        }
      );
    });

    // Important case: We do not want deleteByQuery to be called with an empty bool.should, this can result in all revision docs being deleted
    it('should skip deletions of a policy revision if the calculated cutoff idx from minimum used revision is equal or below 0', async () => {
      mockEsClient.esql.query
        .mockResolvedValueOnce(latestRevisionsResponse([['policy-1', 15, 15]]))
        .mockResolvedValueOnce(minUsedResponse([['policy-1', 5]]));

      mockEsClient.deleteByQuery.mockResolvedValue({
        deleted: 5,
      } as any);

      await mockTask.runTask(taskInstance, mockCore, signal);

      expect(logger.debug).toHaveBeenCalledWith(
        '[FleetPolicyRevisionsCleanupTask] No policy revisions to delete after evaluating agent usage.'
      );
      expect(mockEsClient.deleteByQuery).not.toHaveBeenCalledWith();
    });
    it('should never run deleteByQuery if after calculating revision cutoff indexes from minimum used by agents results in no revisions to delete', async () => {
      mockEsClient.esql.query
        .mockResolvedValueOnce(
          latestRevisionsResponse([
            ['policy-1', 15, 15],
            ['policy-2', 15, 15],
          ])
        )
        .mockResolvedValueOnce(
          minUsedResponse([
            ['policy-1', 15],
            ['policy-2', 5],
          ])
        );

      mockEsClient.deleteByQuery.mockResolvedValue({
        deleted: 5,
      } as any);

      await mockTask.runTask(taskInstance, mockCore, signal);

      expect(logger.info).toHaveBeenCalledWith(
        '[FleetPolicyRevisionsCleanupTask] Found 2 policies with more than 10 revisions.'
      );
      expect(mockEsClient.deleteByQuery).toHaveBeenCalledWith(
        {
          index: '.fleet-policies',
          ...expectedDeleteByQueryConfig,
          query: {
            bool: {
              should: [
                {
                  bool: {
                    must: [
                      { term: { policy_id: 'policy-1' } },
                      { range: { revision_idx: { lte: 5 } } }, // 15 - 10 = 5
                    ],
                  },
                },
              ],
            },
          },
        },
        {
          signal,
        }
      );
    });

    it('should calculate the deletion cutoff for a policy from the latest revision if not used by agents', async () => {
      mockEsClient.esql.query
        .mockResolvedValueOnce(latestRevisionsResponse([['policy-1', 20, 20]]))
        .mockResolvedValueOnce(minUsedResponse([]));

      mockEsClient.deleteByQuery.mockResolvedValue({
        deleted: 5,
      } as any);

      await mockTask.runTask(taskInstance, mockCore, signal);

      expect(logger.info).toHaveBeenCalledWith(
        '[FleetPolicyRevisionsCleanupTask] Found 1 policies with more than 10 revisions.'
      );
      expect(mockEsClient.deleteByQuery).toHaveBeenCalledWith(
        {
          index: '.fleet-policies',
          ...expectedDeleteByQueryConfig,
          query: {
            bool: {
              should: [
                {
                  bool: {
                    must: [
                      { term: { policy_id: 'policy-1' } },
                      { range: { revision_idx: { lte: 10 } } }, // 20 - 10 = 10
                    ],
                  },
                },
              ],
            },
          },
        },
        {
          signal,
        }
      );
    });

    it('should invoke the orphan sweep on every run and log deleted count when documents are removed', async () => {
      mockedSweepOrphanedFleetPolicies.mockResolvedValueOnce({ deletedCount: 5 });

      mockEsClient.esql.query.mockResolvedValue(latestRevisionsResponse([]));

      await mockTask.runTask(taskInstance, mockCore, signal);

      expect(mockedSweepOrphanedFleetPolicies).toHaveBeenCalledTimes(1);
      expect(mockedSweepOrphanedFleetPolicies).toHaveBeenCalledWith(
        mockEsClient,
        expect.objectContaining({ logger, signal })
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Orphan sweep removed 5 documents')
      );
    });

    it('should skip the orphan sweep when enableFleetOrphanedPolicySweep is disabled', async () => {
      mockAppContextService.getExperimentalFeatures.mockReturnValue({
        enableFleetPolicyRevisionsCleanupTask: true,
        enableFleetOrphanedPolicySweep: false,
      } as any);

      mockEsClient.esql.query.mockResolvedValue(latestRevisionsResponse([]));

      await mockTask.runTask(taskInstance, mockCore, signal);

      expect(mockedSweepOrphanedFleetPolicies).not.toHaveBeenCalled();
    });
  });

  describe('query methods', () => {
    beforeEach(async () => {
      await mockTask.start({ taskManager: mockTaskManagerStart });
    });

    it('should query max revisions and counts correctly', async () => {
      mockEsClient.esql.query.mockResolvedValue(latestRevisionsResponse([]));

      await mockTask.runTask(taskInstance, mockCore, signal);

      expect(mockEsClient.esql.query).toHaveBeenCalledWith(
        {
          query:
            'FROM .fleet-policies | STATS doc_count = COUNT(*), latest_revision = MAX(revision_idx) BY policy_id | SORT doc_count DESC, policy_id ASC | LIMIT 100',
          params: [],
        },
        {
          signal,
        }
      );
    });

    it('should query minimum revisions used by agents filtered to the policy ids with more than max revisions', async () => {
      mockEsClient.esql.query
        .mockResolvedValueOnce(
          latestRevisionsResponse([
            ['policy-1', 15, 15],
            ['policy-2', 1, 20],
            ['policy-3', 10, 12],
            ['policy-4', 12, 12],
          ])
        )
        .mockResolvedValueOnce(minUsedResponse([]));

      mockEsClient.deleteByQuery.mockResolvedValue({ deleted: 0 } as any);

      await mockTask.runTask(taskInstance, mockCore, signal);

      expect(mockEsClient.esql.query).toHaveBeenCalledWith(
        {
          query:
            'FROM .fleet-agents | WHERE (policy_id IN (?policyIds)) AND active == TRUE | STATS min_used_revision = MIN(policy_revision_idx) BY policy_id | LIMIT 100',
          params: [{ policyIds: ['policy-1', 'policy-4'] }],
        },
        {
          signal,
        }
      );
    });
  });
});
