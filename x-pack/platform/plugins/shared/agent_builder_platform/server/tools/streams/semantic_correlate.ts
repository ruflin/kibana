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
import type { CoreSetup } from '@kbn/core/server';
import type { PluginStartDependencies } from '../../types';
import { callSemanticCorrelate } from './call_streams_internal';

const schema = z.object({
  query: z
    .string()
    .describe('Natural-language query (e.g. alert rule name or a question about systems/features)'),
  stream: z.string().optional().describe('Optional stream name to scope results'),
  size: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .default(10)
    .describe('Max number of feature hits (default 10)'),
  include_queries: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include related significant-event queries in results'),
  include_insights: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include previously generated insights in results'),
});

export const semanticCorrelateToolId = `${internalNamespaces.streams}.semantic_correlate`;

export const semanticCorrelateTool = (
  coreSetup: CoreSetup<PluginStartDependencies>
): BuiltinToolDefinition<typeof schema> => ({
  id: semanticCorrelateToolId,
  type: ToolType.builtin,
  description: `Find Streams features (and optionally significant-event queries and insights) that are semantically related to a natural-language query. Use for correlating alerts or questions with identified systems/features. Requires Streams plugin.`,
  schema,
  tags: ['streams'],
  handler: async (
    {
      query,
      stream,
      size = 10,
      include_queries: includeQueries = false,
      include_insights: includeInsights = false,
    },
    { request, spaceId, logger }
  ) => {
    try {
      const [core] = await coreSetup.getStartServices();
      const data = await callSemanticCorrelate(request, core, spaceId, {
        query,
        stream,
        size,
        include_queries: includeQueries,
        include_insights: includeInsights,
      });
      return {
        results: [
          createOtherResult({
            type: 'semantic_correlate',
            data,
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`semantic_correlate failed: ${message}`);
      return {
        results: [
          createErrorResult({
            message: `Semantic correlate failed: ${message}. Ensure Streams plugin is enabled and you have access.`,
          }),
        ],
      };
    }
  },
});
