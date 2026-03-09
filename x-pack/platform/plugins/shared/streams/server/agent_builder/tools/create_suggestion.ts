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

const createSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        title: z.string().describe('Short, human-readable name for the suggestion'),
        description: z
          .string()
          .describe('What the query does technically (e.g. "Counts 5xx errors per service")'),
        reason: z
          .string()
          .describe('Why this suggestion was created, referencing source discoveries'),
        esql_query: z
          .string()
          .describe(
            'Valid ES|QL query string. Must include a FROM clause targeting the stream. Use MATCH(field, "text") for text field filtering.'
          ),
        type: z
          .enum(['alert', 'dashboard', 'slo', 'viz', 'investigation'])
          .describe(
            'What Kibana object to create: alert (threshold detection), dashboard (multi-panel), slo (service level indicator), viz (single visualization), investigation (manual investigation)'
          ),
        query_type: z
          .enum(['row', 'stats'])
          .default('row')
          .describe(
            'ES|QL query type: row (event-level FROM...WHERE) or stats (aggregation FROM...STATS...BY)'
          ),
        priority: z
          .enum(['critical', 'high', 'medium', 'low'])
          .default('medium')
          .describe('Priority derived from source discovery severity'),
        discovery_refs: z
          .array(z.string())
          .default([])
          .describe('UUIDs of discoveries this suggestion was derived from'),
        stream_refs: z
          .array(z.string())
          .default([])
          .describe('Stream names the query targets'),
      })
    )
    .describe('Suggestions to create'),
});

export const CREATE_SUGGESTION_TOOL_ID = `${internalNamespaces.streams}.create_suggestion`;

export const createCreateSuggestionTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof createSuggestionSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof createSuggestionSchema> = {
    id: CREATE_SUGGESTION_TOOL_ID,
    type: ToolType.builtin,
    description: `Create actionable ES|QL query suggestions that can become alerts, dashboards, SLOs, or visualizations.

When to use:
- After analyzing discoveries, to propose concrete monitoring queries
- When the user asks to generate suggestions from existing discoveries
- To create alert rules, dashboard panels, SLO definitions, or visualizations
- To propose investigation queries for manual analysis

Each suggestion includes an ES|QL query, its purpose (alert/dashboard/slo/viz/investigation), and references to the source discoveries and streams.`,
    schema: createSuggestionSchema,
    tags: ['streams', 'suggestions'],
    handler: async (toolParams, { request }) => {
      try {
        const discoveryClient = await deps.getDiscoveryClient(request);

        const created = await Promise.all(
          toolParams.suggestions.map((s) =>
            discoveryClient.createSuggestion({
              title: s.title,
              description: s.description,
              reason: s.reason,
              type: s.type,
              esql_query: s.esql_query,
              query_type: s.query_type,
              priority: s.priority,
              discovery_refs: s.discovery_refs,
              stream_refs: s.stream_refs,
              status: 'pending',
            })
          )
        );

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                suggestions: created,
                message: `Created ${created.length} suggestion(s): ${created.map((s) => `"${s.title}" (${s.uuid})`).join(', ')}`,
              },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to create suggestions: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
