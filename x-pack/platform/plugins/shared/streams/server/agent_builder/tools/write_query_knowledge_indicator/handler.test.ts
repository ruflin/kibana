/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import type { Streams } from '@kbn/streams-schema';
import type { QueryClient } from '../../../lib/streams/assets/query/query_client';
import type { StreamsClient } from '../../../lib/streams/client';
import { writeQueryKnowledgeIndicatorHandler } from './handler';
import { validateEsqlQueryForStreamOrThrow } from '../../../lib/significant_events/validate_esql_query';

jest.mock('../../../lib/significant_events/validate_esql_query', () => ({
  validateEsqlQueryForStreamOrThrow: jest.fn(),
}));

describe('writeQueryKnowledgeIndicatorHandler', () => {
  const logger = loggingSystemMock.createLogger();

  const mockDefinition = {
    name: 'logs.test',
  } as unknown as Streams.all.Definition;

  const streamsClient = {
    getStream: jest.fn(),
  } as unknown as StreamsClient;

  const queryClient = {
    upsert: jest.fn(),
  } as unknown as QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    (streamsClient.getStream as jest.Mock).mockResolvedValue(mockDefinition);
    (queryClient.upsert as jest.Mock).mockResolvedValue(undefined);
    (validateEsqlQueryForStreamOrThrow as jest.Mock).mockReturnValue(undefined);
  });

  it('calls streamsClient.getStream with the correct stream name', async () => {
    await writeQueryKnowledgeIndicatorHandler({
      streamsClient,
      queryClient,
      logger,
      params: {
        stream_name: 'logs.test',
        query_id: 'my-query',
        title: 'My Query',
        description: 'A test query',
        esql: { query: 'FROM logs.test, logs.test.* METADATA _id, _source' },
      },
    });

    expect(streamsClient.getStream).toHaveBeenCalledWith('logs.test');
  });

  it('validates the ES|QL query against the stream definition', async () => {
    const esqlQuery = 'FROM logs.test, logs.test.* METADATA _id, _source';

    await writeQueryKnowledgeIndicatorHandler({
      streamsClient,
      queryClient,
      logger,
      params: {
        stream_name: 'logs.test',
        query_id: 'my-query',
        title: 'My Query',
        description: '',
        esql: { query: esqlQuery },
      },
    });

    expect(validateEsqlQueryForStreamOrThrow).toHaveBeenCalledWith({
      esqlQuery,
      stream: mockDefinition,
    });
  });

  it('calls queryClient.upsert with the correct parameters', async () => {
    await writeQueryKnowledgeIndicatorHandler({
      streamsClient,
      queryClient,
      logger,
      params: {
        stream_name: 'logs.test',
        query_id: 'my-query',
        title: 'My Query',
        description: 'A test query',
        esql: { query: 'FROM logs.test, logs.test.* METADATA _id, _source' },
        severity_score: 75,
        evidence: ['evidence-1'],
      },
    });

    expect(queryClient.upsert).toHaveBeenCalledWith(mockDefinition, {
      id: 'my-query',
      title: 'My Query',
      description: 'A test query',
      esql: { query: 'FROM logs.test, logs.test.* METADATA _id, _source' },
      severity_score: 75,
      evidence: ['evidence-1'],
    });
  });

  it('returns acknowledged: true', async () => {
    const result = await writeQueryKnowledgeIndicatorHandler({
      streamsClient,
      queryClient,
      logger,
      params: {
        stream_name: 'logs.test',
        query_id: 'my-query',
        title: 'My Query',
        description: '',
        esql: { query: 'FROM logs.test, logs.test.* METADATA _id, _source' },
      },
    });

    expect(result).toEqual({ acknowledged: true });
  });

  it('propagates errors thrown by validateEsqlQueryForStreamOrThrow', async () => {
    (validateEsqlQueryForStreamOrThrow as jest.Mock).mockImplementation(() => {
      throw new Error('Invalid ES|QL query');
    });

    await expect(
      writeQueryKnowledgeIndicatorHandler({
        streamsClient,
        queryClient,
        logger,
        params: {
          stream_name: 'logs.test',
          query_id: 'my-query',
          title: 'My Query',
          description: '',
          esql: { query: 'INVALID' },
        },
      })
    ).rejects.toThrow('Invalid ES|QL query');

    expect(queryClient.upsert).not.toHaveBeenCalled();
  });

  it('propagates errors thrown by queryClient.upsert', async () => {
    (queryClient.upsert as jest.Mock).mockRejectedValue(new Error('ES write failed'));

    await expect(
      writeQueryKnowledgeIndicatorHandler({
        streamsClient,
        queryClient,
        logger,
        params: {
          stream_name: 'logs.test',
          query_id: 'my-query',
          title: 'My Query',
          description: '',
          esql: { query: 'FROM logs.test, logs.test.* METADATA _id, _source' },
        },
      })
    ).rejects.toThrow('ES write failed');
  });
});
