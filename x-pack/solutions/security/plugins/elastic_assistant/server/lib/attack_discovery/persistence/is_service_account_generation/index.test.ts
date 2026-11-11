/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core-elasticsearch-server-mocks';
import { ATTACK_DISCOVERY_EVENT_SERVICE_ACCOUNT_TAG } from '@kbn/discoveries';

import { isServiceAccountGeneration } from '.';
import { ATTACK_DISCOVERY_EVENT_PROVIDER } from '../../../../../common/constants';

const params = {
  eventLogIndex: 'test-event-log-index',
  executionUuid: 'test-execution-uuid',
  spaceId: 'test-space-id',
};

const mockEsqlResponse = (rows: number) => ({
  columns: [{ name: '@timestamp', type: 'date' as const }],
  values: Array.from({ length: rows }, () => ['2026-01-01T00:00:00.000Z']),
});

describe('isServiceAccountGeneration', () => {
  let esClient: ReturnType<typeof elasticsearchServiceMock.createElasticsearchClient>;

  beforeEach(() => {
    esClient = elasticsearchServiceMock.createElasticsearchClient();
  });

  it('queries the service account generation events', async () => {
    esClient.esql.query.mockResolvedValue(mockEsqlResponse(0));

    await isServiceAccountGeneration({ ...params, esClient });

    expect(esClient.esql.query).toHaveBeenCalledWith({
      query:
        'FROM test-event-log-index | WHERE event.provider == ?provider AND kibana.alert.rule.execution.uuid == ?executionUuid | LIMIT 1',
      params: [
        { provider: ATTACK_DISCOVERY_EVENT_PROVIDER },
        { executionUuid: 'test-execution-uuid' },
      ],
      filter: {
        bool: {
          filter: [
            { term: { 'kibana.space_ids': 'test-space-id' } },
            { term: { tags: ATTACK_DISCOVERY_EVENT_SERVICE_ACCOUNT_TAG } },
          ],
        },
      },
    });
  });

  it('returns true when a tagged event exists', async () => {
    esClient.esql.query.mockResolvedValue(mockEsqlResponse(1));

    expect(await isServiceAccountGeneration({ ...params, esClient })).toBe(true);
  });

  it('returns false when no tagged event exists', async () => {
    esClient.esql.query.mockResolvedValue(mockEsqlResponse(0));

    expect(await isServiceAccountGeneration({ ...params, esClient })).toBe(false);
  });

  it('returns false when the event log index does not exist', async () => {
    esClient.esql.query.mockRejectedValue(
      Object.assign(new Error('verification_exception'), {
        statusCode: 400,
        body: { error: { type: 'verification_exception', reason: 'Unknown index [x]' } },
      })
    );

    expect(await isServiceAccountGeneration({ ...params, esClient })).toBe(false);
  });
});
