/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import type { FeatureClient } from '../../../lib/streams/feature/feature_client';
import type { StreamsClient } from '../../../lib/streams/client';
import { writeFeatureKnowledgeIndicatorHandler } from './handler';

describe('writeFeatureKnowledgeIndicatorHandler', () => {
  const logger = loggingSystemMock.createLogger();

  const streamsClient = {
    ensureStream: jest.fn(),
  } as unknown as StreamsClient;

  const featureClient = {
    bulk: jest.fn(),
  } as unknown as FeatureClient;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls ensureStream with the correct stream name', async () => {
    (featureClient.bulk as jest.Mock).mockResolvedValue(undefined);

    await writeFeatureKnowledgeIndicatorHandler({
      streamsClient,
      featureClient,
      logger,
      params: {
        stream_name: 'logs.test',
        id: 'my-feature',
        type: 'error_pattern',
        description: 'A test feature',
        properties: {},
        confidence: 80,
      },
    });

    expect(streamsClient.ensureStream).toHaveBeenCalledWith('logs.test');
  });

  it('calls featureClient.bulk with a single index operation containing the feature', async () => {
    (featureClient.bulk as jest.Mock).mockResolvedValue(undefined);

    await writeFeatureKnowledgeIndicatorHandler({
      streamsClient,
      featureClient,
      logger,
      params: {
        stream_name: 'logs.test',
        id: 'my-feature',
        type: 'error_pattern',
        description: 'A test feature',
        properties: { key: 'value' },
        confidence: 75,
        tags: ['test'],
      },
    });

    expect(featureClient.bulk).toHaveBeenCalledTimes(1);
    const [streamName, operations] = (featureClient.bulk as jest.Mock).mock.calls[0];
    expect(streamName).toBe('logs.test');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toHaveProperty('index');
    const { feature } = operations[0].index;
    expect(feature.id).toBe('my-feature');
    expect(feature.type).toBe('error_pattern');
    expect(feature.stream_name).toBe('logs.test');
    expect(feature.status).toBe('active');
    expect(feature.properties).toEqual({ key: 'value' });
    expect(feature.tags).toEqual(['test']);
    expect(typeof feature.uuid).toBe('string');
    expect(typeof feature.last_seen).toBe('string');
  });

  it('returns acknowledged: true and the generated uuid', async () => {
    (featureClient.bulk as jest.Mock).mockResolvedValue(undefined);

    const result = await writeFeatureKnowledgeIndicatorHandler({
      streamsClient,
      featureClient,
      logger,
      params: {
        stream_name: 'logs.test',
        id: 'my-feature',
        type: 'error_pattern',
        description: 'A test feature',
        properties: {},
        confidence: 60,
      },
    });

    expect(result.acknowledged).toBe(true);
    expect(typeof result.uuid).toBe('string');
    expect(result.uuid.length).toBeGreaterThan(0);
  });

  it('propagates errors thrown by featureClient.bulk', async () => {
    (featureClient.bulk as jest.Mock).mockRejectedValue(new Error('ES write failed'));

    await expect(
      writeFeatureKnowledgeIndicatorHandler({
        streamsClient,
        featureClient,
        logger,
        params: {
          stream_name: 'logs.test',
          id: 'my-feature',
          type: 'error_pattern',
          description: 'A test feature',
          properties: {},
          confidence: 60,
        },
      })
    ).rejects.toThrow('ES write failed');
  });

  it('propagates errors thrown by streamsClient.ensureStream', async () => {
    (streamsClient.ensureStream as jest.Mock).mockRejectedValue(new Error('Stream not found'));

    await expect(
      writeFeatureKnowledgeIndicatorHandler({
        streamsClient,
        featureClient,
        logger,
        params: {
          stream_name: 'logs.missing',
          id: 'my-feature',
          type: 'error_pattern',
          description: 'A test feature',
          properties: {},
          confidence: 60,
        },
      })
    ).rejects.toThrow('Stream not found');

    expect(featureClient.bulk).not.toHaveBeenCalled();
  });
});
