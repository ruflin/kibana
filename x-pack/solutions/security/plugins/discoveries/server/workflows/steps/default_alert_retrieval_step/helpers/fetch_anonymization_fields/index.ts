/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { AnonymizationFieldResponse } from '@kbn/elastic-assistant-common/impl/schemas';

/**
 * Fetches anonymization fields from the AI Assistant index for the given space.
 * Returns an empty array when the index does not exist or the query fails.
 */
export const fetchAnonymizationFields = async ({
  esClient,
  spaceId,
}: {
  esClient: ElasticsearchClient;
  spaceId: string;
}): Promise<AnonymizationFieldResponse[]> => {
  const index = `.kibana-elastic-ai-assistant-anonymization-fields-${spaceId}`;

  try {
    const response = await esClient.esql.query({
      query: esql.from([index], ['_id', '_source']).limit(1000).print('basic'),
    });

    return response.values.flatMap(([id, rawSource]) => {
      if (rawSource == null || typeof rawSource !== 'object') return [];
      const source = rawSource as Record<string, unknown>;
      return [
        {
          allowed: source.allowed as boolean,
          anonymized: source.anonymized as boolean,
          createdAt: source.created_at as string | undefined,
          createdBy: source.created_by as string | undefined,
          field: source.field as string,
          id: typeof id === 'string' ? id : '',
          namespace: source.namespace as string | undefined,
          timestamp: source['@timestamp'] as string | undefined,
          updatedAt: source.updated_at as string | undefined,
          updatedBy: source.updated_by as string | undefined,
        },
      ];
    });
  } catch {
    // If the index doesn't exist or there's an error, return empty array.
    return [];
  }
};
