/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type { BuiltinToolDefinition, StaticToolRegistration } from '@kbn/agent-builder-server';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type { StreamsToolsDependencies } from './types';

const getQueryDefinitionsSchema = z.object({
  streamName: z.string().describe('Stream name to get query definitions for'),
});

export const GET_QUERY_DEFINITIONS_TOOL_ID = `${internalNamespaces.streams}.get_query_definitions`;

export const createGetQueryDefinitionsTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof getQueryDefinitionsSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof getQueryDefinitionsSchema> = {
    id: GET_QUERY_DEFINITIONS_TOOL_ID,
    type: ToolType.builtin,
    description: `Read sig events query definitions for a stream. Returns query titles, KQL filters, ES|QL queries, query purpose, associated features, severity scores, and whether each query is backed by an active Kibana rule.

Query purposes:
- detection: Detects specific significant events (errors, failures, anomalies)
- exclusion: Noise-canceling queries that identify known-noisy patterns to filter out
- stats: Aggregation-based metrics (error rates, throughput, latency percentiles)
- baseline: Normal operating range references for anomaly detection
- correlation: Co-occurrence analysis across fields or streams

When to use:
- Getting a compact view of query definitions with their KQL/ES|QL and purpose
- Understanding which query purposes are already covered (to avoid duplicates)
- Understanding which queries are rule-backed vs unbacked
- Reviewing detection coverage for a stream before generating new queries`,
    schema: getQueryDefinitionsSchema,
    tags: ['streams', 'queries', 'definitions'],
    handler: async (toolParams, { request }) => {
      try {
        const { QueryService } = await import('../../lib/streams/assets/query/query_service');
        const queryService = new QueryService(deps.core, deps.logger);
        const queryClient = await queryService.getClientWithRequest({ request });
        const queries = await queryClient.getAssets(toolParams.streamName);

        const definitions = queries.map((q) => ({
          id: q.query.id,
          title: q.query.title,
          esql: q.query.esql.query,
          query_purpose: q.query.query_purpose ?? 'detection',
          severity_score: q.query.severity_score,
          rule_backed: q.rule_backed,
        }));

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                streamName: toolParams.streamName,
                queries: definitions,
                count: definitions.length,
              },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: {
                message: `Failed to get query definitions: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
