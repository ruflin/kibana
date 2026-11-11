/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, savedObjectsClientMock } from '@kbn/core/server/mocks';
import { merge } from 'lodash';

import type { NewAgentAction, AgentActionType } from '../../../common/types';
import { createAppContextStartContractMock, type MockedFleetAppContext } from '../../mocks';
import { appContextService } from '../app_context';
import { auditLoggingService } from '../audit_logging';

import { agentPolicyService } from '../agent_policy';

import { SCHEDULED_UNENROLL_ACTION_ID_PREFIX } from '../../../common/constants';

import {
  bulkCreateAgentActionResults,
  bulkCreateAgentActions,
  cancelAgentAction,
  createAgentAction,
  getAgentsByActionsIds,
  transformDataSecrets,
} from './actions';

import { bulkUpdateAgents } from './crud';

jest.mock('./crud');
jest.mock('../audit_logging');
jest.mock('../agent_policy');
jest.mock('../secrets', () => ({
  isActionSecretStorageEnabled: jest.fn(),
  toCompiledSecretRef: jest.fn((id: string) => `$co.elastic.secret{${id}}`),
}));

const mockedAgentPolicyService = agentPolicyService as jest.Mocked<typeof agentPolicyService>;

const mockedBulkUpdateAgents = bulkUpdateAgents as jest.MockedFunction<typeof bulkUpdateAgents>;
const mockedAuditLoggingService = auditLoggingService as jest.Mocked<typeof auditLoggingService>;

const policyIdsResponse = (policyIds: string[]) =>
  ({
    columns: [{ name: 'policy_id', type: 'keyword' }],
    values: policyIds.map((id) => [id]),
  } as any);

const idsResponse = (ids: string[]) =>
  ({ columns: [{ name: '_id', type: 'keyword' }], values: ids.map((id) => [id]) } as any);

const actionsResponse = (sources: Array<Record<string, unknown>>) =>
  ({
    columns: [
      { name: '_id', type: 'keyword' },
      { name: '_source', type: '_source' },
    ],
    values: sources.map((source, i) => [`doc-${i}`, source]),
  } as any);

describe('Agent actions', () => {
  let mockContext: MockedFleetAppContext;

  beforeEach(async () => {
    mockContext = createAppContextStartContractMock();
    appContextService.start(mockContext);
  });

  afterEach(() => {
    appContextService.stop();
    mockedAuditLoggingService.writeCustomAuditLog.mockReset();
  });

  describe('getAgentActions', () => {
    it('should call audit logger', async () => {
      const esClientMock = elasticsearchServiceMock.createInternalClient();

      esClientMock.esql.query.mockResolvedValue(
        actionsResponse([
          {
            action_id: 'action1',
            agents: ['agent1'],
            expiration: new Date().toISOString(),
            type: 'UPGRADE',
          },
        ])
      );

      await getAgentsByActionsIds(esClientMock, ['action1']);

      expect(mockedAuditLoggingService.writeCustomAuditLog).toHaveBeenCalledWith({
        message: `User retrieved Fleet action [id=action1]`,
      });
    });
  });

  describe('createAgentAction', () => {
    beforeEach(() => {
      mockContext.messageSigningService.sign = jest
        .fn()
        .mockImplementation((message: Record<string, unknown>) =>
          Promise.resolve({
            data: Buffer.from(JSON.stringify(message), 'utf8'),
            signature: 'thisisasignature',
          })
        );
    });

    it('should call audit logger', async () => {
      const esClient = elasticsearchServiceMock.createInternalClient();
      esClient.search.mockResolvedValue({
        hits: {
          hits: [
            {
              _source: {
                type: 'UPGRADE',
                action_id: 'action1',
                agents: ['agent1', 'agent2'],
                expiration: new Date().toISOString(),
              },
            },
          ],
        },
      } as any);
      const soClient = savedObjectsClientMock.create();

      await createAgentAction(esClient, soClient, {
        id: 'action1',
        type: 'UPGRADE',
        agents: ['agent1'],
      });

      expect(mockedAuditLoggingService.writeCustomAuditLog).toHaveBeenCalledWith({
        message: expect.stringMatching(/User created Fleet action/),
      });
    });

    it.each(['UNENROLL', 'UPGRADE', 'MIGRATE', 'RESTART'] as AgentActionType[])(
      'should sign %s action',
      async (actionType: AgentActionType) => {
        const esClient = elasticsearchServiceMock.createInternalClient();
        esClient.search.mockResolvedValue({
          hits: {
            hits: [
              {
                _source: {
                  type: actionType,
                  action_id: 'action1',
                  agents: ['agent1', 'agent2'],
                  expiration: new Date().toISOString(),
                },
              },
            ],
          },
        } as any);
        const soClient = savedObjectsClientMock.create();

        await createAgentAction(esClient, soClient, {
          id: 'action1',
          type: actionType,
          agents: ['agent1'],
        });

        expect(esClient.create).toHaveBeenCalledWith(
          expect.objectContaining({
            document: expect.objectContaining({
              signed: {
                data: expect.any(String),
                signature: expect.any(String),
              },
            }),
          })
        );
      }
    );

    it.each([
      'SETTINGS',
      'POLICY_REASSIGN',
      'CANCEL',
      'FORCE_UNENROLL',
      'UPDATE_TAGS',
      'REQUEST_DIAGNOSTICS',
      'POLICY_CHANGE',
      'INPUT_ACTION',
    ] as AgentActionType[])('should not sign %s action', async (actionType: AgentActionType) => {
      const esClient = elasticsearchServiceMock.createInternalClient();
      esClient.search.mockResolvedValue({
        hits: {
          hits: [
            {
              _source: {
                type: actionType,
                action_id: 'action1',
                agents: ['agent1', 'agent2'],
                expiration: new Date().toISOString(),
              },
            },
          ],
        },
      } as any);
      const soClient = savedObjectsClientMock.create();

      await createAgentAction(esClient, soClient, {
        id: 'action1',
        type: actionType,
        agents: ['agent1'],
      });

      expect(esClient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.not.objectContaining({
            signed: expect.any(Object),
          }),
        })
      );
    });
  });

  describe('bulkCreateAgentAction', () => {
    it('should call audit logger', async () => {
      const esClient = elasticsearchServiceMock.createInternalClient();

      const newActions: NewAgentAction[] = [
        {
          id: 'action1',
          type: 'UPGRADE',
          agents: ['agent1'],
        },
        {
          id: 'action2',
          type: 'UPGRADE',
          agents: ['agent2'],
        },
        {
          id: 'action3',
          type: 'UPGRADE',
          agents: ['agent3'],
        },
      ];

      await bulkCreateAgentActions(esClient, newActions);

      for (const action of newActions) {
        expect(mockedAuditLoggingService.writeCustomAuditLog).toHaveBeenCalledWith({
          message: `User created Fleet action [id=${action.id}]`,
        });
      }
    });

    it.each(['UNENROLL', 'UPGRADE', 'MIGRATE', 'RESTART'] as AgentActionType[])(
      'should sign %s action',
      async (actionType: AgentActionType) => {
        const esClient = elasticsearchServiceMock.createInternalClient();

        await bulkCreateAgentActions(esClient, [
          { id: 'action1', type: actionType, agents: ['agent1'] },
        ]);

        expect(esClient.bulk).toHaveBeenCalledWith(
          expect.objectContaining({
            operations: expect.arrayContaining([
              expect.arrayContaining([
                expect.objectContaining({
                  type: actionType,
                  signed: {
                    data: expect.any(String),
                    signature: expect.any(String),
                  },
                }),
              ]),
            ]),
          })
        );
      }
    );

    it('should not sign actions other than UNENROLL, UPGRADE, MIGRATE and RESTART', async () => {
      const esClient = elasticsearchServiceMock.createInternalClient();
      const newActions: NewAgentAction[] = (
        [
          'SETTINGS',
          'POLICY_REASSIGN',
          'CANCEL',
          'FORCE_UNENROLL',
          'UPDATE_TAGS',
          'REQUEST_DIAGNOSTICS',
          'POLICY_CHANGE',
          'INPUT_ACTION',
        ] as AgentActionType[]
      ).map((actionType, i) => {
        const actionId = `action${i + 1}`;
        return {
          id: actionId,
          type: actionType,
          agents: [actionId],
        };
      });

      await bulkCreateAgentActions(esClient, newActions);
      expect(esClient.bulk).toHaveBeenCalledWith(
        expect.objectContaining({
          operations: expect.arrayContaining([
            expect.arrayContaining([
              expect.not.objectContaining({
                signed: {
                  data: expect.any(String),
                  signature: expect.any(String),
                },
              }),
            ]),
          ]),
        })
      );
    });
  });

  describe('bulkCreateAgentActionResults', () => {
    it('should call audit logger', async () => {
      const mockEsClient = elasticsearchServiceMock.createInternalClient();

      await bulkCreateAgentActionResults(mockEsClient, [
        {
          actionId: 'action1',
          agentId: 'agent1',
        },
      ]);

      expect(mockedAuditLoggingService.writeCustomAuditLog).toHaveBeenCalledWith({
        message: `User created Fleet action result [id=action1]`,
      });
    });
  });

  describe('cancelAgentAction', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should throw if the target action is not found', async () => {
      const esClient = elasticsearchServiceMock.createInternalClient();
      esClient.search.mockResolvedValue({
        hits: {
          hits: [],
        },
      } as any);
      const soClient = savedObjectsClientMock.create();
      await expect(() => cancelAgentAction(esClient, soClient, 'i-do-not-exists')).rejects.toThrow(
        /Action not found/
      );
    });

    it('should create one CANCEL action for each UPGRADE action found', async () => {
      const esClient = elasticsearchServiceMock.createInternalClient();
      esClient.search.mockResolvedValue({
        hits: {
          hits: [
            {
              _source: {
                action_id: 'action1',
                agents: ['agent1', 'agent2'],
                expiration: '2022-05-12T18:16:18.019Z',
                type: 'UPGRADE',
              },
            },
            {
              _source: {
                action_id: 'action1',
                agents: ['agent3', 'agent4'],
                expiration: '2022-05-12T18:16:18.019Z',
                type: 'UPGRADE',
              },
            },
          ],
        },
      } as any);
      const soClient = savedObjectsClientMock.create();
      await cancelAgentAction(esClient, soClient, 'action1');

      expect(esClient.create).toHaveBeenCalledTimes(2);
      expect(esClient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            type: 'CANCEL',
            data: { target_id: 'action1' },
            agents: ['agent1', 'agent2'],
          }),
        })
      );
      expect(esClient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            type: 'CANCEL',
            data: { target_id: 'action1' },
            agents: ['agent3', 'agent4'],
          }),
        })
      );
    });

    it('should cancel UPGRADE action', async () => {
      const esClient = elasticsearchServiceMock.createInternalClient();
      esClient.search.mockResolvedValue({
        hits: {
          hits: [
            {
              _source: {
                type: 'UPGRADE',
                action_id: 'action1',
                agents: ['agent1', 'agent2'],
                expiration: '2022-05-12T18:16:18.019Z',
              },
            },
          ],
        },
      } as any);
      const soClient = savedObjectsClientMock.create();
      await cancelAgentAction(esClient, soClient, 'action1');

      expect(mockedBulkUpdateAgents).toHaveBeenCalled();
      expect(mockedBulkUpdateAgents).toHaveBeenCalledWith(
        expect.anything(),
        [
          expect.objectContaining({ agentId: 'agent1' }),
          expect.objectContaining({ agentId: 'agent2' }),
        ],
        {}
      );
    });

    it('should create a CANCEL action for a scheduled UNENROLL action', async () => {
      const esClient = elasticsearchServiceMock.createInternalClient();
      // 1: find UNENROLL action
      // 2: look up agent policy_ids from .fleet-agents
      // 3: concurrent-batch re-query
      // 4: look up other pending scheduled UNENROLL batches (cancelPendingBatches)
      esClient.esql.query.mockResolvedValueOnce(policyIdsResponse(['policy-1', 'policy-1']));
      esClient.search
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  type: 'UNENROLL',
                  action_id: 'unenroll-action-1',
                  agents: ['agent1', 'agent2'],
                  expiration: '2099-05-12T18:16:18.019Z',
                  start_time: '2099-05-12T18:00:00.000Z',
                },
              },
            ],
          },
        } as any)
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  type: 'UNENROLL',
                  action_id: 'unenroll-action-1',
                  agents: ['agent1', 'agent2'],
                  expiration: '2099-05-12T18:16:18.019Z',
                  start_time: '2099-05-12T18:00:00.000Z',
                },
              },
            ],
          },
        } as any)
        .mockResolvedValueOnce({ hits: { hits: [] } } as any); // no other pending batches

      mockedAgentPolicyService.update = jest.fn().mockResolvedValue({});

      const soClient = savedObjectsClientMock.create();
      await cancelAgentAction(esClient, soClient, 'unenroll-action-1');

      expect(esClient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            type: 'CANCEL',
            data: { target_id: 'unenroll-action-1' },
            agents: ['agent1', 'agent2'],
          }),
        })
      );
    });

    it('should NOT call bulkUpdateAgents (updateAgentsToHealthy) when cancelling UNENROLL', async () => {
      const esClient = elasticsearchServiceMock.createInternalClient();
      esClient.esql.query.mockResolvedValueOnce(policyIdsResponse([])); // no policy_id found
      esClient.search
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  type: 'UNENROLL',
                  action_id: 'unenroll-action-1',
                  agents: ['agent1'],
                  expiration: '2099-05-12T18:16:18.019Z',
                },
              },
            ],
          },
        } as any)
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  type: 'UNENROLL',
                  action_id: 'unenroll-action-1',
                  agents: ['agent1'],
                  expiration: '2099-05-12T18:16:18.019Z',
                },
              },
            ],
          },
        } as any);
      // No policy IDs found so cancel-other-batches step is skipped (no searches 4/5)

      mockedAgentPolicyService.update = jest.fn().mockResolvedValue({});

      const soClient = savedObjectsClientMock.create();
      await cancelAgentAction(esClient, soClient, 'unenroll-action-1');

      expect(mockedBulkUpdateAgents).not.toHaveBeenCalled();
    });

    it('should disable unenroll_timeout on the agent policy when cancelling UNENROLL', async () => {
      const esClient = elasticsearchServiceMock.createInternalClient();
      const scheduledActionId = `${SCHEDULED_UNENROLL_ACTION_ID_PREFIX}test-action-1`;
      esClient.esql.query.mockResolvedValueOnce(policyIdsResponse(['policy-abc']));
      esClient.search
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  type: 'UNENROLL',
                  action_id: scheduledActionId,
                  agents: ['agent1'],
                  expiration: '2099-05-12T18:16:18.019Z',
                  start_time: '2099-05-12T18:00:00.000Z',
                },
              },
            ],
          },
        } as any)
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  type: 'UNENROLL',
                  action_id: scheduledActionId,
                  agents: ['agent1'],
                  expiration: '2099-05-12T18:16:18.019Z',
                  start_time: '2099-05-12T18:00:00.000Z',
                },
              },
            ],
          },
        } as any)
        .mockResolvedValueOnce({ hits: { hits: [] } } as any); // no other pending batches

      mockedAgentPolicyService.update = jest.fn().mockResolvedValue({});

      const soClient = savedObjectsClientMock.create();
      await cancelAgentAction(esClient, soClient, scheduledActionId);

      expect(mockedAgentPolicyService.update).toHaveBeenCalledWith(
        soClient,
        expect.anything(),
        'policy-abc',
        { unenroll_timeout: 0 }
      );
    });

    it('should cancel other pending scheduled UNENROLL batches for the same policy', async () => {
      const esClient = elasticsearchServiceMock.createInternalClient();
      esClient.esql.query.mockResolvedValueOnce(policyIdsResponse(['policy-abc']));
      esClient.search
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  type: 'UNENROLL',
                  action_id: 'ScheduledUnenrollInactiveAgents-batch-1',
                  agents: ['agent1'],
                  expiration: '2099-05-12T18:16:18.019Z',
                  start_time: '2099-05-12T18:00:00.000Z',
                },
              },
            ],
          },
        } as any)
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  type: 'UNENROLL',
                  action_id: 'ScheduledUnenrollInactiveAgents-batch-1',
                  agents: ['agent1'],
                  expiration: '2099-05-12T18:16:18.019Z',
                  start_time: '2099-05-12T18:00:00.000Z',
                },
              },
            ],
          },
        } as any)
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  type: 'UNENROLL',
                  // batch-2 shares agent1 with batch-1, so the in-memory intersection matches
                  action_id: 'ScheduledUnenrollInactiveAgents-batch-2',
                  agents: ['agent1', 'agent2'],
                  expiration: '2099-05-12T18:16:18.019Z',
                  start_time: '2099-05-12T18:00:00.000Z',
                },
              },
            ],
          },
        } as any); // another pending batch for same policy

      mockedAgentPolicyService.update = jest.fn().mockResolvedValue({});

      const soClient = savedObjectsClientMock.create();
      await cancelAgentAction(esClient, soClient, 'ScheduledUnenrollInactiveAgents-batch-1');

      // Should have created two CANCEL actions: one for batch-1, one for batch-2
      expect(esClient.create).toHaveBeenCalledTimes(2);
      expect(esClient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            type: 'CANCEL',
            data: { target_id: 'ScheduledUnenrollInactiveAgents-batch-2' },
          }),
        })
      );
    });

    it('should NOT call cancelPendingBatches or agentPolicyService.update when cancelling a manual (non-prefixed) UNENROLL', async () => {
      const esClient = elasticsearchServiceMock.createInternalClient();
      // 1: find UNENROLL action (non-prefixed action_id — manual unenrollment)
      // 2: agent policy lookup
      // 3: concurrent-batch re-query
      esClient.esql.query.mockResolvedValueOnce(policyIdsResponse(['policy-abc']));
      esClient.search
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  type: 'UNENROLL',
                  action_id: 'manual-unenroll-action-1',
                  agents: ['agent1'],
                  expiration: '2099-05-12T18:16:18.019Z',
                },
              },
            ],
          },
        } as any)
        .mockResolvedValueOnce({
          hits: {
            hits: [
              {
                _source: {
                  type: 'UNENROLL',
                  action_id: 'manual-unenroll-action-1',
                  agents: ['agent1'],
                  expiration: '2099-05-12T18:16:18.019Z',
                },
              },
            ],
          },
        } as any);
      // No searches 4/5 — cancelPendingBatches must NOT be called

      mockedAgentPolicyService.update = jest.fn().mockResolvedValue({});
      const soClient = savedObjectsClientMock.create();
      await cancelAgentAction(esClient, soClient, 'manual-unenroll-action-1');

      // CANCEL action is still created (cancellation itself works)
      expect(esClient.create).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            type: 'CANCEL',
            data: { target_id: 'manual-unenroll-action-1' },
          }),
        })
      );
      // Side effects are skipped because the action ID lacks the scheduled prefix
      expect(mockedAgentPolicyService.update).not.toHaveBeenCalled();
      // Only 2 searches (find action, concurrent re-query) and the ES|QL policy lookup — no cancelPendingBatches searches
      expect(esClient.search).toHaveBeenCalledTimes(2);
      expect(esClient.esql.query).toHaveBeenCalledTimes(1);
    });

    it('should NOT call agentPolicyService.update when cancelling UPGRADE', async () => {
      const esClient = elasticsearchServiceMock.createInternalClient();
      esClient.search.mockResolvedValue({
        hits: {
          hits: [
            {
              _source: {
                type: 'UPGRADE',
                action_id: 'action1',
                agents: ['agent1'],
                expiration: '2022-05-12T18:16:18.019Z',
              },
            },
          ],
        },
      } as any);

      mockedAgentPolicyService.update = jest.fn().mockResolvedValue({});
      const soClient = savedObjectsClientMock.create();
      await cancelAgentAction(esClient, soClient, 'action1');

      expect(mockedAgentPolicyService.update).not.toHaveBeenCalled();
    });
  });

  describe('getAgentsByActionsIds', () => {
    const esClientMock = elasticsearchServiceMock.createElasticsearchClient();

    beforeEach(() => {
      esClientMock.esql.query.mockReset();
    });

    it('should find agents by passing actions Ids', async () => {
      esClientMock.esql.query.mockResolvedValue(
        actionsResponse([
          {
            action_id: 'action2',
            agents: ['agent3', 'agent4'],
            expiration: '2022-05-12T18:16:18.019Z',
            type: 'UPGRADE',
          },
        ])
      );
      const actionsIds = ['action2'];
      expect(await getAgentsByActionsIds(esClientMock, actionsIds)).toEqual(['agent3', 'agent4']);

      const request = esClientMock.esql.query.mock.calls[0][0] as any;
      expect(request.query).toEqual(
        'FROM .fleet-actions METADATA _id, _source | WHERE action_id IN (?actionIds) | KEEP _id, _source | LIMIT 10000'
      );
      expect(request.params).toEqual([{ actionIds: ['action2'] }]);
    });

    it('should find agents by passing multiple actions Ids', async () => {
      esClientMock.esql.query.mockResolvedValue(
        actionsResponse([
          {
            action_id: 'action2',
            agents: ['agent3', 'agent4'],
            expiration: '2022-05-12T18:16:18.019Z',
            type: 'UPGRADE',
          },
          {
            action_id: 'action3',
            agents: ['agent5', 'agent6', 'agent7'],
            expiration: '2022-05-12T18:16:18.019Z',
            type: 'UNENROLL',
          },
        ])
      );
      const actionsIds = ['action2', 'actions3'];
      expect(await getAgentsByActionsIds(esClientMock, actionsIds)).toEqual([
        'agent3',
        'agent4',
        'agent5',
        'agent6',
        'agent7',
      ]);
    });

    it('should find agents assigned to agent policies when passing agent policy action ids', async () => {
      esClientMock.esql.query.mockResolvedValue(idsResponse(['agent1', 'agent2']));
      const actionsIds = ['action1:1'];
      expect(await getAgentsByActionsIds(esClientMock, actionsIds)).toEqual(['agent1', 'agent2']);
    });

    it('should find agents when passing both agent action and agent policy action ids', async () => {
      esClientMock.esql.query
        .mockResolvedValueOnce(
          actionsResponse([
            {
              action_id: 'action2',
              agents: ['agent3', 'agent4'],
              expiration: '2022-05-12T18:16:18.019Z',
              type: 'UPGRADE',
            },
            {
              action_id: 'action3',
              agents: ['agent5', 'agent6', 'agent7'],
              expiration: '2022-05-12T18:16:18.019Z',
              type: 'UNENROLL',
            },
          ])
        )
        .mockResolvedValueOnce(idsResponse(['agent1', 'agent2']));

      const actionsIds = ['action1:1', 'action2', 'actions3'];

      // policy changes are processed second
      expect(await getAgentsByActionsIds(esClientMock, actionsIds)).toEqual([
        'agent3',
        'agent4',
        'agent5',
        'agent6',
        'agent7',
        'agent1',
        'agent2',
      ]);
    });

    it('should return an empty array if no actions were found', async () => {
      esClientMock.esql.query.mockResolvedValue({
        columns: [{ name: '_id', type: 'keyword' }],
        values: [],
      } as any);
      const actionsIds = ['action1:1', 'action2'];
      expect(await getAgentsByActionsIds(esClientMock, actionsIds)).toEqual([]);
    });

    it('should find agents by passing actions Ids by querying actions results', async () => {
      esClientMock.esql.query.mockImplementation(((params: any) =>
        params.query.startsWith('FROM .fleet-actions ')
          ? actionsResponse([
              {
                action_id: 'action2',
                agents: ['agent3'],
                total: 2,
                expiration: '2022-05-12T18:16:18.019Z',
                type: 'UPGRADE',
              },
            ])
          : {
              columns: [{ name: 'agent_id', type: 'keyword' }],
              values: [['agent4']],
            }) as any);
      const actionsIds = ['action2'];
      expect(await getAgentsByActionsIds(esClientMock, actionsIds)).toEqual(['agent3', 'agent4']);

      const resultsRequest = esClientMock.esql.query.mock.calls[1][0] as any;
      expect(resultsRequest.query).toEqual(
        'FROM .fleet-actions-results | WHERE (action_id IN (?actionIds)) AND error IS NOT NULL | KEEP agent_id | LIMIT 10000'
      );
    });

    it('should ignore a missing actions results index', async () => {
      esClientMock.esql.query.mockImplementation((async (params: any) => {
        if (params.query.startsWith('FROM .fleet-actions ')) {
          return actionsResponse([{ action_id: 'action2', agents: ['agent3'], total: 2 }]);
        }
        throw {
          statusCode: 400,
          body: {
            error: {
              type: 'verification_exception',
              reason: 'Found 1 problem\nline 1:1: Unknown index [.fleet-actions-results]',
            },
          },
        };
      }) as any);
      expect(await getAgentsByActionsIds(esClientMock, ['action2'])).toEqual(['agent3']);
    });
  });

  describe('transformDataSecrets', () => {
    it('should transform secret references from {id: string} to $co.elastic.secret{id}', () => {
      const testAction: NewAgentAction = {
        type: 'PRIVILEGE_LEVEL_CHANGE',
        agents: ['agent1'],
        data: {
          user_info: {
            username: 'user1',
            groupname: 'group1',
          },
        },
        secrets: {
          user_info: {
            password: {
              id: 'passwordref1',
            },
          },
        },
      };
      const testMergedData = merge(testAction.data, testAction.secrets);
      expect(transformDataSecrets(testMergedData)).toEqual({
        user_info: {
          username: 'user1',
          groupname: 'group1',
          password: '$co.elastic.secret{passwordref1}',
        },
      });
    });
  });
});
