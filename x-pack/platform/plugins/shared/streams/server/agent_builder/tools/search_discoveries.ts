/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type { BuiltinToolDefinition, StaticToolRegistration } from '@kbn/agent-builder-server';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type { StreamsToolsDependencies } from './types';

const searchDiscoveriesSchema = z.object({
  query: z
    .string()
    .optional()
    .describe('Natural language query for semantic search over discoveries'),
  streamName: z.string().optional().describe('Filter by stream name'),
  severity: z
    .enum(['critical', 'high', 'medium', 'low'])
    .optional()
    .describe('Filter by severity level'),
  level: z.number().optional().describe('Filter by discovery level (0=base, 1=meta, 2=meta²)'),
  minRelevanceScore: z.number().optional().describe('Minimum relevance score (0-100) to filter by'),
  size: z.number().optional().default(20).describe('Maximum number of results to return'),
});

export const SEARCH_DISCOVERIES_TOOL_ID = `${internalNamespaces.streams}.search_discoveries`;

export const createSearchDiscoveriesTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof searchDiscoveriesSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof searchDiscoveriesSchema> = {
    id: SEARCH_DISCOVERIES_TOOL_ID,
    type: ToolType.builtin,
    description: `Search and list discoveries from the SigDiscovery pipeline.

When to use:
- Finding existing discoveries for a stream or across all streams
- Searching for discoveries by natural language query (semantic search)
- Filtering discoveries by severity, relevance score, or level
- Checking for existing discoveries before creating new ones`,
    schema: searchDiscoveriesSchema,
    tags: ['streams', 'discoveries'],
    handler: async (toolParams, { request }) => {
      try {
        const discoveryClient = await deps.getDiscoveryClient(request);
        const discoveries = await discoveryClient.searchDiscoveries({
          ...toolParams,
          semanticSearch: !!toolParams.query,
        });

        return {
          results: [
            {
              type: ToolResultType.other,
              data: { total: discoveries.length, discoveries },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to search discoveries: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
