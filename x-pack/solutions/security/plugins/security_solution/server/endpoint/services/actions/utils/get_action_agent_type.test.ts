/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';
import type { ElasticsearchClientMock } from '@kbn/core-elasticsearch-client-server-mocks';
import { getActionAgentType } from './get_action_agent_type';
import { ENDPOINT_ACTIONS_INDEX } from '../../../../../common/endpoint/constants';

describe('getActionAgentType()', () => {
  let esClientMock: ElasticsearchClientMock;

  beforeEach(() => {
    esClientMock = elasticsearchServiceMock.createScopedClusterClient().asInternalUser;
  });

  const esqlResponse = (values: unknown[][]) =>
    ({
      columns: [{ name: 'EndpointActions.input_type', type: 'keyword' }],
      values,
    } as never);

  it('should throw error if action is not found', async () => {
    esClientMock.esql.query.mockResolvedValue(esqlResponse([]));

    await expect(getActionAgentType(esClientMock, '123')).rejects.toThrow(
      'Action id [123] not found'
    );
  });

  it('should return agent type', async () => {
    esClientMock.esql.query.mockResolvedValue(esqlResponse([['endpoint']]));

    await expect(getActionAgentType(esClientMock, '123')).resolves.toEqual({
      agentType: 'endpoint',
    });
  });

  it('should look the action up by id with ES|QL', async () => {
    esClientMock.esql.query.mockResolvedValue(esqlResponse([['endpoint']]));

    await getActionAgentType(esClientMock, '123');

    expect(esClientMock.esql.query).toHaveBeenCalledWith(
      {
        query: `FROM ${ENDPOINT_ACTIONS_INDEX} | WHERE action_id == ?actionId | KEEP EndpointActions.input_type | LIMIT 1`,
        params: [{ actionId: '123' }],
      },
      { signal: undefined }
    );
  });
});
