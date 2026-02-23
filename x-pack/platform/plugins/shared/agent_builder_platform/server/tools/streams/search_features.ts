/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { ToolType } from '@kbn/agent-builder-common';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type { BuiltinToolDefinition } from '@kbn/agent-builder-server';
import { createErrorResult, createOtherResult } from '@kbn/agent-builder-server';
import type {
  QueryDslQueryContainer,
  SearchRequest,
} from '@elastic/elasticsearch/lib/api/types';

const FEATURES_INDEX = '.kibana_streams_features*';

const SEMANTIC_FIELDS = [
  'feature.description_semantic',
  'feature.evidence_semantic',
  'feature.properties_summary',
];

const SOURCE_FIELDS = [
  'stream.name',
  'feature.id',
  'feature.type',
  'feature.subtype',
  'feature.title',
  'feature.description',
  'feature.confidence',
  'feature.evidence',
  'feature.status',
  'feature.tags',
  'feature.last_seen',
];

const schema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'Natural-language query for semantic search over feature descriptions, evidence, and properties. Omit to search by field filters only.'
    ),
  stream: z.string().optional().describe('Filter by stream name'),
  type: z.string().optional().describe('Filter by feature type (e.g. "entity", "infrastructure", "technology")'),
  subtype: z.string().optional().describe('Filter by feature subtype (e.g. "service", "cloud_deployment")'),
  min_confidence: z
    .number()
    .optional()
    .describe('Minimum confidence score (0-100)'),
  size: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Max results to return (default 20)'),
});

export const searchFeaturesToolId = `${internalNamespaces.streams}.search_features`;

export const searchFeaturesTool = (): BuiltinToolDefinition<typeof schema> => ({
  id: searchFeaturesToolId,
  type: ToolType.builtin,
  description:
    'Search Streams features (identified systems, services, infrastructure) by field filters and/or semantic similarity. ' +
    'Features represent entities discovered in log streams such as services, cloud deployments, container runtimes, and schemas. ' +
    'Use the "query" parameter for natural-language semantic search, or filter by stream, type, subtype, and confidence.',
  schema,
  tags: ['streams'],
  handler: async (
    { query, stream, type, subtype, min_confidence: minConfidence, size = 20 },
    { esClient, logger }
  ) => {
    try {
      const filter: QueryDslQueryContainer[] = [];
      if (stream) {
        filter.push({ term: { 'stream.name': stream } });
      }
      if (type) {
        filter.push({ term: { 'feature.type': type } });
      }
      if (subtype) {
        filter.push({ term: { 'feature.subtype': subtype } });
      }
      if (typeof minConfidence === 'number') {
        filter.push({ range: { 'feature.confidence': { gte: minConfidence } } });
      }
      filter.push({
        bool: {
          should: [
            { bool: { must_not: { exists: { field: 'feature.expires_at' } } } },
            { range: { 'feature.expires_at': { gte: 'now' } } },
          ],
          minimum_should_match: 1,
        },
      });

      let searchRequest: SearchRequest;

      if (query) {
        const semanticRetrievers = SEMANTIC_FIELDS.map((field) => ({
          standard: {
            query: {
              bool: {
                filter,
                must: [{ semantic: { field, query } }],
              },
            },
          },
        }));

        searchRequest = {
          index: FEATURES_INDEX,
          size,
          retriever: {
            rrf: {
              retrievers: semanticRetrievers,
              rank_window_size: size * 2,
            },
          },
          _source: SOURCE_FIELDS,
        };
      } else {
        searchRequest = {
          index: FEATURES_INDEX,
          size,
          query: { bool: { filter } },
          sort: [{ 'feature.confidence': { order: 'desc' } }],
          _source: SOURCE_FIELDS,
        };
      }

      const response = await esClient.asCurrentUser.search(searchRequest);
      const hits = (response.hits.hits ?? []).map((hit) => ({
        ...(hit._source as Record<string, unknown>),
        _score: hit._score,
      }));

      return {
        results: [
          createOtherResult({
            type: 'search_features',
            data: {
              total: hits.length,
              features: hits,
            },
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`search_features failed: ${message}`);
      return {
        results: [
          createErrorResult({
            message: `Search features failed: ${message}`,
          }),
        ],
      };
    }
  },
});
