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
import type { Logger } from '@kbn/core/server';
import dedent from 'dedent';
import type { ObservabilityAgentBuilderCoreSetup } from '../../../types';
import { getAgentBuilderResourceAvailability } from '../../../utils/get_agent_builder_resource_availability';

const INSIGHTS_INDEX = '.kibana_streams_insights*';

const SEMANTIC_FIELDS = [
  'insight.title_semantic',
  'insight.description_semantic',
  'insight.recommendations_semantic',
];

const SOURCE_FIELDS = [
  'stream.name',
  'insight.id',
  'insight.uuid',
  'insight.title',
  'insight.description',
  'insight.impact',
  'insight.category',
  'insight.source',
  'insight.status',
  'insight.confidence',
  'insight.evidence',
  'insight.recommendations',
  'insight.related_features',
  'insight.related_queries',
  'insight.tags',
  'insight.time_range',
  'insight.created_at',
  'insight.updated_at',
];

const schema = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'Natural-language query for semantic search over insight titles, descriptions, and recommendations. Omit to search by field filters only.'
    ),
  stream: z.string().optional().describe('Filter by stream name'),
  impact: z
    .enum(['critical', 'high', 'medium', 'low'])
    .optional()
    .describe('Filter by impact level'),
  category: z
    .enum(['anomaly', 'trend', 'correlation', 'error_spike', 'performance', 'capacity', 'other'])
    .optional()
    .describe('Filter by insight category'),
  status: z
    .enum(['new', 'acknowledged', 'resolved', 'dismissed'])
    .optional()
    .describe('Filter by insight status'),
  min_confidence: z.number().optional().describe('Minimum confidence score (0-100)'),
  size: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe('Max results to return (default 20)'),
});

export const STREAMS_SEARCH_INSIGHTS_TOOL_ID = `${internalNamespaces.streams}.search_insights`;

export const createSearchInsightsTool = ({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): BuiltinToolDefinition<typeof schema> => ({
  id: STREAMS_SEARCH_INSIGHTS_TOOL_ID,
  type: ToolType.builtin,
  description: dedent`
    Search persisted Streams insights by field filters and/or semantic similarity.
    Insights are structured findings from investigations — anomalies, trends, correlations,
    and performance issues discovered by agents, tasks, or users.

    When to use:
    - Finding previous investigation findings relevant to a current incident
    - Checking if a similar issue has been seen before
    - Reviewing unresolved insights for a specific stream
    - Correlating current observations with historical insights

    When NOT to use:
    - Searching for stream features (use streams.search_features)
    - Searching for significant event queries (use streams.search_queries)
  `,
  schema,
  tags: ['streams', 'insights'],
  availability: {
    cacheMode: 'space',
    handler: async ({ request }) => {
      return getAgentBuilderResourceAvailability({ core, request, logger });
    },
  },
  handler: async (
    { query, stream, impact, category, status, min_confidence: minConfidence, size = 20 },
    { esClient, logger: toolLogger }
  ) => {
    try {
      const filter: QueryDslQueryContainer[] = [];
      if (stream) {
        filter.push({ term: { 'stream.name': stream } });
      }
      if (impact) {
        filter.push({ term: { 'insight.impact': impact } });
      }
      if (category) {
        filter.push({ term: { 'insight.category': category } });
      }
      if (status) {
        filter.push({ term: { 'insight.status': status } });
      }
      if (typeof minConfidence === 'number') {
        filter.push({ range: { 'insight.confidence': { gte: minConfidence } } });
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
          index: INSIGHTS_INDEX,
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
          index: INSIGHTS_INDEX,
          size,
          query: { bool: { filter } },
          sort: [{ 'insight.created_at': { order: 'desc' } }],
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
            type: 'search_insights',
            data: {
              total: hits.length,
              insights: hits,
            },
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLogger.error(`search_insights failed: ${message}`);
      return {
        results: [
          createErrorResult({
            message: `Search insights failed: ${message}`,
          }),
        ],
      };
    }
  },
});
