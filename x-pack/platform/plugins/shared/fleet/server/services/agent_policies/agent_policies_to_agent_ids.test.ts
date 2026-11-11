/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClientMock } from '@kbn/core-elasticsearch-client-server-mocks';
import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';

import { getAgentIdsForAgentPolicies } from './agent_policies_to_agent_ids';

describe('getAgentIdsForAgentPolicies', () => {
  let esClientMock: ElasticsearchClientMock;
  let agentPolicyIds: string[];
  let agents: string[];

  beforeEach(() => {
    agentPolicyIds = ['agent-policy-id-a', 'agent-policy-id-b'];

    agents = ['agent-id-a', 'agent-id-b', 'agent-id-c'];

    esClientMock = elasticsearchServiceMock.createClusterClient().asInternalUser;
    esClientMock.esql.query.mockImplementation((async () => ({
      columns: [{ name: '_id', type: 'keyword' }],
      values: agents.map((id) => [id]),
    })) as any);
  });

  it('should return an array of agent ids', async () => {
    expect(await getAgentIdsForAgentPolicies(esClientMock, agentPolicyIds)).toEqual([
      'agent-id-a',
      'agent-id-b',
      'agent-id-c',
    ]);
  });

  it('should return an empty array if no agents were found', async () => {
    agents = [];
    expect(await getAgentIdsForAgentPolicies(esClientMock, agentPolicyIds)).toEqual([]);
  });

  it('should match the agents on a version specific or the sentinel policy of the agent policies', async () => {
    await getAgentIdsForAgentPolicies(esClientMock, agentPolicyIds);

    const request = esClientMock.esql.query.mock.calls[0][0] as any;
    // by `policy_base_id`, so `<id>#sentinel` agents match, and not by a prefix on `policy_id`
    expect(request.query).toEqual(
      'FROM .fleet-agents METADATA _id | WHERE (policy_base_id IN (?baseIds)) OR (policy_id IN (?p1)) AND policy_base_id IS NULL | KEEP _id | LIMIT 100'
    );
    expect(request.params).toEqual([{ baseIds: agentPolicyIds }, { p1: agentPolicyIds }]);
  });
});
