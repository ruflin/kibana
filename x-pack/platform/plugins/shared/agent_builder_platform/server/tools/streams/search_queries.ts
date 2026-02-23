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

const QUERIES_INDEX = '.kibana_streams_assets*';

const SEMANTIC_FIELDS = ['query.title_semantic', 'query.kql.query_semantic'];

const SOURCE_FIELDS = [
  'stream.name',
  'asset.uuid',
  'asset.id',
  'asset.type',
  'query.title',
  'query.kql.query',
  'query.esql.query',
  'query.severity_score',
  'rule_backed',
  'experimental.query.system.name',
  'experimental.query.system.type',
  'experimental.query.evidence',
];

const schema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'Natural-language query for semantic search over query titles and KQL bodies. Omit to search by field filters only.'
    ),
  stream: z.string().optional().describe('Filter by stream name'),
  feature_name: z
    .string()
    .optional()
    .describe('Filter by the feature/system name this query is associated with'),
  min_severity: z
    .number()
    .optional()
    .describe('Minimum severity score to include'),
  rule_backed: z
    .boolean()
    .optional()
    .describe('Filter by whether a Kibana rule exists for this query'),
  size: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Max results to return (default 20)'),
});

export const searchQueriesToolId = `${internalNamespaces.streams}.search_queries`;

export const searchQueriesTool = (): BuiltinToolDefinition<typeof schema> => ({
  id: searchQueriesToolId,
  type: ToolType.builtin,
  description:
    'Search Streams significant-event queries by field filters and/or semantic similarity. ' +
    'Significant-event queries are KQL or ES|QL queries linked to streams that detect notable events (errors, anomalies, security issues). ' +
    'Use the "query" parameter for natural-language semantic search, or filter by stream, feature name, severity, and rule status.',
  schema,
  tags: ['streams'],
  handler: async (
    {
      query,
      stream,
      feature_name: featureName,
      min_severity: minSeverity,
      rule_backed: ruleBacked,
      size = 20,
    },
    { esClient, logger }
  ) => {
    try {
      const filter: QueryDslQueryContainer[] = [];
      if (stream) {
        filter.push({ term: { 'stream.name': stream } });
      }
      if (featureName) {
        filter.push({ term: { 'experimental.query.system.name': featureName } });
      }
      if (typeof minSeverity === 'number') {
        filter.push({ range: { 'query.severity_score': { gte: minSeverity } } });
      }
      if (typeof ruleBacked === 'boolean') {
        filter.push({ term: { rule_backed: ruleBacked } });
      }

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
          index: QUERIES_INDEX,
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
          index: QUERIES_INDEX,
          size,
          query: { bool: { filter } },
          sort: [{ 'query.severity_score': { order: 'desc' } }],
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
            type: 'search_queries',
            data: {
              total: hits.length,
              queries: hits,
            },
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`search_queries failed: ${message}`);
      return {
        results: [
          createErrorResult({
            message: `Search queries failed: ${message}`,
          }),
        ],
      };
    }
  },
});
