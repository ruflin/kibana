/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchClientMock } from '@kbn/core-elasticsearch-client-server-mocks';
import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { conversationExists } from './conversation_exists';

describe('conversationExists', () => {
  let loggerMock: ReturnType<typeof loggingSystemMock.createLogger>;
  let esClient: ReturnType<
    typeof elasticsearchClientMock.createScopedClusterClient
  >['asCurrentUser'];

  beforeEach(() => {
    loggerMock = loggingSystemMock.createLogger();
    esClient = elasticsearchClientMock.createScopedClusterClient().asCurrentUser;
  });

  test('returns true when conversation exists', async () => {
    esClient.esql.query.mockResponse({
      columns: [{ name: '_id', type: 'keyword' }],
      values: [['test-id']],
    });

    const result = await conversationExists({
      esClient,
      logger: loggerMock,
      conversationIndex: '.kibana-elastic-ai-assistant-conversations',
      id: 'test-id',
    });

    expect(result).toBe(true);
    expect(esClient.esql.query).toHaveBeenCalledWith({
      query:
        'FROM .kibana-elastic-ai-assistant-conversations METADATA _id | WHERE _id == ?id | LIMIT 1',
      params: [{ id: 'test-id' }],
    });
  });

  test('returns false when conversation does not exist', async () => {
    esClient.esql.query.mockResponse({ columns: [{ name: '_id', type: 'keyword' }], values: [] });

    const result = await conversationExists({
      esClient,
      logger: loggerMock,
      conversationIndex: '.kibana-elastic-ai-assistant-conversations',
      id: 'non-existent-id',
    });

    expect(result).toBe(false);
  });

  test('returns false and logs error when the query throws error', async () => {
    const error = new Error('Search failed');
    esClient.esql.query.mockRejectedValue(error);

    const result = await conversationExists({
      esClient,
      logger: loggerMock,
      conversationIndex: '.kibana-elastic-ai-assistant-conversations',
      id: 'test-id',
    });

    expect(result).toBe(false);
    expect(loggerMock.error).toHaveBeenCalledWith(
      'Error checking if conversation exists: Error: Search failed with id: test-id'
    );
  });
});
