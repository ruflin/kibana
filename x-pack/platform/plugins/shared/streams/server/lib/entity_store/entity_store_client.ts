/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { getErrorMessage } from '../streams/errors/parse_error';

export interface EntityStoreEntity {
  id: string;
  type: 'host' | 'user' | 'service' | 'generic';
  name: string;
  metadata?: Record<string, unknown>;
}

export class EntityStoreClient {
  constructor(private readonly esClient: ElasticsearchClient, private readonly logger: Logger) {}

  async listEntities(params?: { type?: string; size?: number }): Promise<EntityStoreEntity[]> {
    try {
      const filters: Array<Record<string, unknown>> = [];
      if (params?.type) {
        filters.push({ term: { 'entity.type': params.type } });
      }

      const response = await this.esClient.search({
        index: '.entities.v1.latest.*',
        size: params?.size ?? 50,
        query: filters.length > 0 ? { bool: { filter: filters } } : { match_all: {} },
      });

      return response.hits.hits.map((hit) => {
        const source = hit._source as Record<string, unknown>;
        const entity = (source?.entity ?? {}) as Record<string, unknown>;
        return {
          id: (entity.id as string) ?? hit._id ?? '',
          type: ((entity.type as string) ?? 'generic') as EntityStoreEntity['type'],
          name: (entity.name as string) ?? (entity.id as string) ?? '',
          metadata: source,
        };
      });
    } catch (error) {
      this.logger.debug(`Failed to query Entity Store: ${getErrorMessage(error)}`);
      return [];
    }
  }

  async pushEntityDefinition(entity: {
    type: 'host' | 'user' | 'service' | 'generic';
    name: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ acknowledged: boolean }> {
    try {
      await this.esClient.index({
        index: `.entities.v1.latest.${entity.type}`,
        document: {
          entity: {
            id: entity.name,
            type: entity.type,
            name: entity.name,
          },
          ...entity.metadata,
          '@timestamp': new Date().toISOString(),
        },
      });
      return { acknowledged: true };
    } catch (error) {
      this.logger.warn(`Failed to push entity to Entity Store: ${getErrorMessage(error)}`);
      return { acknowledged: false };
    }
  }
}
