/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggerMock, type MockedLogger } from '@kbn/logging-mocks';
import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { TokenUsageLogger } from './token_usage_logger';

describe('TokenUsageLogger', () => {
  let logger: MockedLogger;
  let esClient: ReturnType<typeof elasticsearchServiceMock.createElasticsearchClient>;
  let tokenUsageLogger: TokenUsageLogger;

  beforeEach(() => {
    logger = loggerMock.create();
    esClient = elasticsearchServiceMock.createElasticsearchClient();
    tokenUsageLogger = new TokenUsageLogger(logger);
    tokenUsageLogger.setEsClient(esClient);
  });

  const defaultTokens = {
    prompt: 100,
    completion: 50,
    total: 150,
  };

  const defaultContext = {
    connectorId: 'my-connector',
    spaceId: 'my-space',
    featureId: 'observability_ai_assistant',
    parentFeatureId: 'observability',
    modelId: 'gpt-4',
    modelCreator: 'OpenAI',
    provider: 'Elastic',
  };

  describe('log', () => {
    it('should create the index template and data stream, then index the document', async () => {
      esClient.indices.putIndexTemplate.mockResolvedValue({} as any);
      esClient.indices.exists.mockResolvedValue(false);
      esClient.indices.createDataStream.mockResolvedValue({} as any);
      esClient.indices.putMapping.mockResolvedValue({} as any);
      esClient.index.mockResolvedValue({} as any);

      await tokenUsageLogger.log({
        tokens: defaultTokens,
        model: 'gpt-4-turbo',
        context: defaultContext,
      });

      expect(esClient.indices.putIndexTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '.kibana-inference-token-usage-template',
          index_patterns: ['.kibana-inference-token-usage'],
          data_stream: { hidden: true },
          template: expect.objectContaining({
            mappings: expect.objectContaining({
              properties: expect.objectContaining({
                '@timestamp': { type: 'date' },
                token_usage: expect.any(Object),
                model: expect.any(Object),
                inference: expect.any(Object),
              }),
            }),
          }),
        })
      );
      expect(esClient.indices.createDataStream).toHaveBeenCalledWith({
        name: '.kibana-inference-token-usage',
      });

      expect(esClient.index).toHaveBeenCalledWith(
        expect.objectContaining({
          index: '.kibana-inference-token-usage',
          op_type: 'create',
          document: expect.objectContaining({
            '@timestamp': expect.any(String),
            token_usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
            },
            model: {
              model_id: 'gpt-4-turbo',
              model_creator: 'OpenAI',
              provider: 'Elastic',
            },
            inference: {
              connector_id: 'my-connector',
              space_id: 'my-space',
              feature_id: 'observability_ai_assistant',
              parent_feature_id: 'observability',
            },
          }),
        })
      );
    });

    it('should apply the mappings to the data stream so existing write indices get new fields', async () => {
      esClient.indices.putIndexTemplate.mockResolvedValue({} as any);
      esClient.indices.exists.mockResolvedValue(true);
      esClient.indices.putMapping.mockResolvedValue({} as any);
      esClient.index.mockResolvedValue({} as any);

      await tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext });

      expect(esClient.indices.putMapping).toHaveBeenCalledWith({
        index: '.kibana-inference-token-usage',
        write_index_only: true,
        properties: expect.objectContaining({
          inference: {
            properties: expect.objectContaining({
              space_id: { type: 'keyword' },
            }),
          },
        }),
      });
      expect(esClient.indices.putMapping.mock.invocationCallOrder[0]).toBeGreaterThan(
        esClient.indices.putIndexTemplate.mock.invocationCallOrder[0]
      );
      expect(esClient.index).toHaveBeenCalled();
    });

    it('should create the data stream after the template is in place', async () => {
      esClient.indices.putIndexTemplate.mockResolvedValue({} as any);
      esClient.indices.exists.mockResolvedValue(false);
      esClient.indices.createDataStream.mockResolvedValue({} as any);
      esClient.indices.putMapping.mockResolvedValue({} as any);
      esClient.index.mockResolvedValue({} as any);

      await tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext });

      expect(esClient.indices.createDataStream.mock.invocationCallOrder[0]).toBeGreaterThan(
        esClient.indices.putIndexTemplate.mock.invocationCallOrder[0]
      );
    });

    it('should skip data stream creation if it already exists', async () => {
      esClient.indices.putIndexTemplate.mockResolvedValue({} as any);
      esClient.indices.exists.mockResolvedValue(true);
      esClient.indices.putMapping.mockResolvedValue({} as any);
      esClient.index.mockResolvedValue({} as any);

      await tokenUsageLogger.log({
        tokens: defaultTokens,
        context: defaultContext,
      });

      expect(esClient.indices.createDataStream).not.toHaveBeenCalled();
      expect(esClient.index).toHaveBeenCalled();
    });

    it('should not set up the data stream again after it has been confirmed', async () => {
      esClient.indices.putIndexTemplate.mockResolvedValue({} as any);
      esClient.indices.exists.mockResolvedValue(true);
      esClient.indices.putMapping.mockResolvedValue({} as any);
      esClient.index.mockResolvedValue({} as any);

      await tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext });
      await tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext });

      expect(esClient.indices.putIndexTemplate).toHaveBeenCalledTimes(1);
      expect(esClient.indices.putMapping).toHaveBeenCalledTimes(1);
      expect(esClient.index).toHaveBeenCalledTimes(2);
    });

    it('should share one setup between concurrent calls', async () => {
      esClient.indices.putIndexTemplate.mockResolvedValue({} as any);
      esClient.indices.exists.mockResolvedValue(true);
      esClient.indices.putMapping.mockResolvedValue({} as any);
      esClient.index.mockResolvedValue({} as any);

      await Promise.all([
        tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext }),
        tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext }),
        tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext }),
      ]);

      expect(esClient.indices.putIndexTemplate).toHaveBeenCalledTimes(1);
      expect(esClient.indices.putMapping).toHaveBeenCalledTimes(1);
      expect(esClient.index).toHaveBeenCalledTimes(3);
    });

    it('should retry the setup on the next call after it fails', async () => {
      esClient.indices.putIndexTemplate.mockResolvedValue({} as any);
      esClient.indices.exists.mockResolvedValue(true);
      esClient.indices.putMapping.mockRejectedValueOnce(new Error('mapping update failed'));
      esClient.indices.putMapping.mockResolvedValueOnce({} as any);
      esClient.index.mockResolvedValue({} as any);

      await tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext });
      await tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext });

      expect(esClient.indices.putMapping).toHaveBeenCalledTimes(2);
      expect(esClient.index).toHaveBeenCalledTimes(1);
    });

    it('should handle resource_already_exists_exception gracefully', async () => {
      esClient.indices.putIndexTemplate.mockResolvedValue({} as any);
      esClient.indices.exists.mockResolvedValue(false);
      esClient.indices.createDataStream.mockRejectedValue({
        meta: { body: { error: { type: 'resource_already_exists_exception' } } },
      });
      esClient.indices.putMapping.mockResolvedValue({} as any);
      esClient.index.mockResolvedValue({} as any);

      await tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext });

      expect(esClient.index).toHaveBeenCalled();
    });

    it('should not write the document when the mapping update fails', async () => {
      esClient.indices.putIndexTemplate.mockResolvedValue({} as any);
      esClient.indices.exists.mockResolvedValue(true);
      esClient.indices.putMapping.mockRejectedValue(new Error('mapping update failed'));

      await tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext });

      expect(esClient.index).not.toHaveBeenCalled();
      expect(logger.get('token_usage').error).toHaveBeenCalledWith(
        'Failed to log token usage: mapping update failed'
      );
    });

    it('should use context modelId when model param is not provided', async () => {
      esClient.indices.exists.mockResolvedValue(true);
      esClient.index.mockResolvedValue({} as any);

      await tokenUsageLogger.log({
        tokens: defaultTokens,
        context: defaultContext,
      });

      expect(esClient.index).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            model: expect.objectContaining({
              model_id: 'gpt-4',
            }),
          }),
        })
      );
    });

    it('should store model_name from context', async () => {
      esClient.indices.exists.mockResolvedValue(true);
      esClient.index.mockResolvedValue({} as any);

      await tokenUsageLogger.log({
        tokens: defaultTokens,
        context: { ...defaultContext, modelName: 'GPT-4 Turbo' },
      });

      expect(esClient.index).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            model: expect.objectContaining({
              model_name: 'GPT-4 Turbo',
            }),
          }),
        })
      );
    });

    it('should prefer the model param over context modelId', async () => {
      esClient.indices.exists.mockResolvedValue(true);
      esClient.index.mockResolvedValue({} as any);

      await tokenUsageLogger.log({
        tokens: defaultTokens,
        model: 'gpt-4-turbo',
        context: defaultContext,
      });

      expect(esClient.index).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            model: expect.objectContaining({
              model_id: 'gpt-4-turbo',
            }),
          }),
        })
      );
    });

    it('should store the space the request was made in', async () => {
      esClient.indices.exists.mockResolvedValue(true);
      esClient.index.mockResolvedValue({} as any);

      await tokenUsageLogger.log({
        tokens: defaultTokens,
        context: { ...defaultContext, spaceId: 'default' },
      });

      expect(esClient.index).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            inference: expect.objectContaining({
              space_id: 'default',
            }),
          }),
        })
      );
    });

    it('should include optional token fields when present', async () => {
      esClient.indices.exists.mockResolvedValue(true);
      esClient.index.mockResolvedValue({} as any);

      await tokenUsageLogger.log({
        tokens: { prompt: 100, completion: 50, thinking: 20, total: 170, cached: 30 },
        context: defaultContext,
      });

      expect(esClient.index).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            token_usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              thinking_tokens: 20,
              total_tokens: 170,
              cached_tokens: 30,
            },
          }),
        })
      );
    });

    it('should warn and skip logging when ES client is not initialized', async () => {
      const uninitializedLogger = new TokenUsageLogger(logger);

      await uninitializedLogger.log({
        tokens: defaultTokens,
        context: defaultContext,
      });

      expect(logger.get('token_usage').warn).toHaveBeenCalledWith(
        'Elasticsearch client not initialized, skipping token usage logging'
      );
    });

    it('should reset dataStreamReady when index is not found, allowing re-creation on next call', async () => {
      esClient.indices.exists.mockResolvedValue(true);
      esClient.indices.putMapping.mockResolvedValue({} as any);
      esClient.index.mockRejectedValueOnce({ meta: { statusCode: 404 } });
      esClient.index.mockResolvedValueOnce({} as any);

      // First call: setup passes, but the write fails with 404
      await tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext });

      // Second call: should set up the data stream again and succeed
      await tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext });

      expect(esClient.indices.putIndexTemplate).toHaveBeenCalledTimes(2);
      expect(esClient.index).toHaveBeenCalledTimes(2);
    });

    it('should log an error and not throw when indexing fails', async () => {
      esClient.indices.exists.mockResolvedValue(true);
      esClient.indices.putMapping.mockResolvedValue({} as any);
      esClient.index.mockRejectedValue(new Error('index write failed'));

      await expect(
        tokenUsageLogger.log({ tokens: defaultTokens, context: defaultContext })
      ).resolves.toBeUndefined();

      expect(logger.get('token_usage').error).toHaveBeenCalledWith(
        'Failed to log token usage: index write failed'
      );
    });
  });
});
