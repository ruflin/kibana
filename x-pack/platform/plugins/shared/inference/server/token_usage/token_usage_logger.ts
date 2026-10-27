/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { Logger } from '@kbn/logging';
import type { ChatCompletionTokenCount } from '@kbn/inference-common';
import type { TokenUsageContext, TokenUsageDocument } from './types';
import { mapTokenCountToDocument } from './types';

const DATA_STREAM_NAME = '.kibana-inference-token-usage';
const INDEX_TEMPLATE_NAME = '.kibana-inference-token-usage-template';

const INDEX_TEMPLATE = {
  index_patterns: [DATA_STREAM_NAME],
  data_stream: {
    hidden: true,
  },
  priority: 500,
  template: {
    settings: {
      auto_expand_replicas: '0-1',
      hidden: true,
    },
    mappings: {
      properties: {
        '@timestamp': { type: 'date' as const },
        token_usage: {
          properties: {
            prompt_tokens: { type: 'long' as const },
            completion_tokens: { type: 'long' as const },
            thinking_tokens: { type: 'long' as const },
            total_tokens: { type: 'long' as const },
            cached_tokens: { type: 'long' as const },
          },
        },
        model: {
          properties: {
            model_id: { type: 'keyword' as const },
            model_creator: { type: 'keyword' as const },
            model_name: { type: 'keyword' as const },
            provider: { type: 'keyword' as const },
          },
        },
        inference: {
          properties: {
            connector_id: { type: 'keyword' as const },
            space_id: { type: 'keyword' as const },
            feature_id: { type: 'keyword' as const },
            parent_feature_id: { type: 'keyword' as const },
          },
        },
      },
    },
  },
};

export class TokenUsageLogger {
  private esClient?: ElasticsearchClient;
  private logger: Logger;
  private dataStreamReady = false;
  private dataStreamSetup?: Promise<void>;

  constructor(logger: Logger) {
    this.logger = logger.get('token_usage');
  }

  setEsClient(esClient: ElasticsearchClient) {
    this.esClient = esClient;
  }

  async log({
    tokens,
    model,
    context,
  }: {
    tokens: ChatCompletionTokenCount;
    model?: string;
    context: TokenUsageContext;
  }): Promise<void> {
    if (!this.esClient) {
      this.logger.warn('Elasticsearch client not initialized, skipping token usage logging');
      return;
    }

    this.logger.debug(
      () => `Logging token usage for connector ${context.connectorId}: ${tokens.total} total tokens`
    );

    try {
      await this.ensureDataStream();
      const document = mapTokenCountToDocument({ tokens, model, context });
      await this.writeDocument(document);
      this.logger.debug(
        () => `Successfully logged token usage for connector ${context.connectorId}`
      );
    } catch (error) {
      this.logger.error(`Failed to log token usage: ${error.message}`);
    }
  }

  private async ensureDataStream(): Promise<void> {
    if (this.dataStreamReady) {
      return;
    }

    // Concurrent calls share one setup so a burst of requests does not queue duplicate cluster state updates.
    this.dataStreamSetup ??= this.setUpDataStream().finally(() => {
      this.dataStreamSetup = undefined;
    });
    await this.dataStreamSetup;
  }

  private async setUpDataStream(): Promise<void> {
    // The template is put once per Kibana process, not only when missing, so existing clusters receive mapping changes.
    await this.esClient!.indices.putIndexTemplate({
      name: INDEX_TEMPLATE_NAME,
      ...INDEX_TEMPLATE,
    });

    const dataStreamExists = await this.esClient!.indices.exists({
      index: DATA_STREAM_NAME,
    });

    if (!dataStreamExists) {
      await this.createDataStream();
    }

    // The template only applies to new backing indices, so the write index needs the mappings before
    // documents with new fields arrive, or they would be mapped dynamically. Older backing indices hold no
    // such documents, and a blocked or conflicting one must not stop logging.
    await this.esClient!.indices.putMapping({
      index: DATA_STREAM_NAME,
      write_index_only: true,
      properties: INDEX_TEMPLATE.template.mappings.properties,
    });

    this.dataStreamReady = true;
  }

  private async createDataStream(): Promise<void> {
    try {
      await this.esClient!.indices.createDataStream({
        name: DATA_STREAM_NAME,
      });
      this.logger.info(`Created data stream ${DATA_STREAM_NAME}`);
    } catch (error) {
      if (error?.meta?.body?.error?.type === 'resource_already_exists_exception') {
        return;
      }
      throw error;
    }
  }

  private async writeDocument(doc: TokenUsageDocument): Promise<void> {
    try {
      await this.esClient!.index({
        index: DATA_STREAM_NAME,
        document: doc,
        op_type: 'create',
      });
    } catch (error) {
      if (
        error?.meta?.statusCode === 404 ||
        error?.meta?.body?.error?.type === 'index_not_found_exception'
      ) {
        this.dataStreamReady = false;
      }
      throw error;
    }
  }
}
