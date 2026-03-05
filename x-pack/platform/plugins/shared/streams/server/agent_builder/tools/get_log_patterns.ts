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

const TIME_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

const parseRelativeTime = (value: string): Date => {
  if (value === 'now') {
    return new Date();
  }
  const match = value.match(/^now-(\d+)([smhdw])$/);
  if (match) {
    const amount = parseInt(match[1], 10);
    const unit = match[2];
    return new Date(Date.now() - amount * (TIME_UNIT_MS[unit] ?? 0));
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid time value: ${value}`);
  }
  return parsed;
};

const getLogPatternsSchema = z.object({
  streamName: z.string().describe('Stream name to analyze'),
  field: z.string().default('message').describe('Field to categorize (usually "message")'),
  from: z.string().default('now-1h').describe('Start time (e.g., "now-1h")'),
  to: z.string().default('now').describe('End time (e.g., "now")'),
  size: z.number().default(20).describe('Number of top patterns to return'),
});

export const GET_LOG_PATTERNS_TOOL_ID = `${internalNamespaces.streams}.get_log_patterns`;

export const createGetLogPatternsTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof getLogPatternsSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof getLogPatternsSchema> = {
    id: GET_LOG_PATTERNS_TOOL_ID,
    type: ToolType.builtin,
    description: `Categorize log messages and return top patterns with counts. Uses Elasticsearch categorize_text aggregation to group similar messages.

When to use:
- Identifying dominant error patterns and exceptions in a stream
- Understanding the distribution of log message types
- Finding recurring patterns that may indicate systematic issues
- Getting an overview of what a stream contains`,
    schema: getLogPatternsSchema,
    tags: ['streams', 'analysis', 'patterns'],
    handler: async (toolParams, { request }) => {
      try {
        const esClient = (await deps.getEsClient(request)).asCurrentUser;
        const from = parseRelativeTime(toolParams.from);
        const to = parseRelativeTime(toolParams.to);

        const response = await esClient.search({
          index: toolParams.streamName,
          size: 0,
          query: {
            bool: {
              filter: [
                {
                  range: {
                    '@timestamp': { gte: from.toISOString(), lte: to.toISOString() },
                  },
                },
              ],
            },
          },
          aggs: {
            log_patterns: {
              categorize_text: {
                field: toolParams.field,
                size: toolParams.size,
              },
            },
          },
        });

        const buckets =
          (
            response.aggregations?.log_patterns as {
              buckets?: Array<{ key: string; doc_count: number }>;
            }
          )?.buckets ?? [];
        const patterns = buckets.map((bucket) => ({
          pattern: bucket.key,
          count: bucket.doc_count,
        }));

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                streamName: toolParams.streamName,
                patterns,
                count: patterns.length,
              },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to get log patterns: ${error instanceof Error ? error.message : String(error)}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
