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

const createDiscoverySchema = z.object({
  title: z.string().describe('Short, actionable title summarizing the discovery'),
  description: z.string().describe('Detailed explanation of what is happening and why it matters'),
  severity: z
    .enum(['critical', 'high', 'medium', 'low'])
    .describe('Severity level of the discovery'),
  relevance_score: z
    .number()
    .min(0)
    .max(100)
    .describe('Relevance score 0-100 based on impact, confidence, novelty, actionability'),
  evidence: z
    .array(
      z.object({
        stream_name: z.string(),
        query_title: z.string(),
        feature_name: z.string().optional(),
        event_count: z.number(),
        change_point_type: z.string().optional(),
        change_point_p_value: z.number().optional(),
      })
    )
    .default([])
    .describe('Evidence supporting this discovery'),
  stream_refs: z.array(z.string()).describe('Stream names this discovery relates to'),
  recommendations: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        priority: z.enum(['critical', 'high', 'medium', 'low']),
        steps: z.array(z.string()),
      })
    )
    .optional()
    .describe('Actionable recommendations'),
  tags: z.array(z.string()).optional().describe('Tags for categorization'),
  level: z.number().default(0).describe('Discovery level: 0=base, 1=meta, 2=meta²'),
  discovery_refs: z
    .array(z.string())
    .optional()
    .describe('Parent discovery UUIDs for meta-discoveries'),
});

export const CREATE_DISCOVERY_TOOL_ID = `${internalNamespaces.streams}.create_discovery`;

export const createCreateDiscoveryTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof createDiscoverySchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof createDiscoverySchema> = {
    id: CREATE_DISCOVERY_TOOL_ID,
    type: ToolType.builtin,
    description: `Persist a new discovery with title, description, severity, relevance score, evidence, and references.

When to use:
- Creating a new discovery from analysis results
- Persisting a finding with evidence and recommendations
- Creating meta-discoveries that synthesize existing discoveries`,
    schema: createDiscoverySchema,
    tags: ['streams', 'discoveries'],
    handler: async (toolParams, { request }) => {
      try {
        const discoveryClient = await deps.getDiscoveryClient(request);

        const cappedLevel = Math.min(toolParams.level, 2);

        const discovery = await discoveryClient.createDiscovery({
          title: toolParams.title,
          description: toolParams.description,
          severity: toolParams.severity,
          relevance_score: toolParams.relevance_score,
          evidence: toolParams.evidence,
          stream_refs: toolParams.stream_refs,
          recommendations: toolParams.recommendations,
          tags: toolParams.tags,
          level: cappedLevel,
          discovery_refs: toolParams.discovery_refs,
          feature_refs: [],
          query_refs: [],
          connector_id: '',
        });

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                discovery,
                message: `Discovery "${discovery.title}" created (${discovery.uuid})`,
              },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to create discovery: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
