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
import type { Logger } from '@kbn/core/server';
import dedent from 'dedent';
import type { ObservabilityAgentBuilderCoreSetup } from '../../../types';
import { getAgentBuilderResourceAvailability } from '../../../utils/get_agent_builder_resource_availability';
import { callStreamsInsightCreate } from './call_streams_internal';

const schema = z.object({
  stream_name: z.string().describe('The stream name to associate the insight with.'),
  title: z.string().describe('Short, descriptive title for the insight (max 200 chars).'),
  description: z
    .string()
    .describe(
      'Detailed description of the finding, including what was observed and why it matters.'
    ),
  impact: z
    .enum(['critical', 'high', 'medium', 'low'])
    .describe('Severity of the insight: critical, high, medium, or low.'),
  category: z
    .enum(['anomaly', 'trend', 'correlation', 'error_spike', 'performance', 'capacity', 'other'])
    .describe('Category of the insight.'),
  confidence: z
    .number()
    .min(0)
    .max(100)
    .describe('Confidence score (0-100) in the accuracy of this insight.'),
  evidence: z
    .array(
      z.object({
        streamName: z.string(),
        queryTitle: z.string(),
        featureName: z.string().optional(),
        eventCount: z.number(),
      })
    )
    .optional()
    .describe('Evidence supporting the insight — queries, features, and event counts.'),
  recommendations: z
    .array(z.string())
    .optional()
    .describe('Actionable recommendations for addressing the insight.'),
  related_feature_uuids: z
    .array(z.string())
    .optional()
    .describe('UUIDs of related stream features.'),
  related_query_ids: z
    .array(z.string())
    .optional()
    .describe('IDs of related significant event queries that this insight justifies or references.'),
  tags: z.array(z.string()).optional().describe('Tags for categorization.'),
  time_range: z
    .object({
      start: z.string().describe('Start of the observation window (ISO 8601).'),
      end: z.string().describe('End of the observation window (ISO 8601).'),
    })
    .optional()
    .describe('Time range during which the insight was observed.'),
});

export const STREAMS_WRITE_INSIGHT_TOOL_ID = `${internalNamespaces.streams}.write_insight`;

export const createWriteInsightTool = ({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): BuiltinToolDefinition<typeof schema> => ({
  id: STREAMS_WRITE_INSIGHT_TOOL_ID,
  type: ToolType.builtin,
  description: dedent`
    Persists a structured insight from an investigation into the Streams insights index.
    Insights are searchable findings that help future investigations and track patterns over time.

    When to use:
    - After completing an investigation and identifying a root cause or notable pattern
    - When discovering an anomaly, trend, or correlation worth recording
    - To create a persistent record of investigation findings for other SREs
    - As the final step in an investigation workflow to close the feedback loop

    When NOT to use:
    - For searching existing insights (use streams.search_insights)
    - For creating significant event queries (use the Streams UI)
    - For temporary notes or intermediate investigation steps

    The insight is automatically marked with source "agent" and status "new".
    Include evidence and recommendations to make the insight actionable.
  `,
  schema,
  tags: ['streams', 'insights', 'write'],
  availability: {
    cacheMode: 'space',
    handler: async ({ request }) => {
      return getAgentBuilderResourceAvailability({ core, request, logger });
    },
  },
  handler: async (params, { request, spaceId, logger: toolLogger }) => {
    try {
      const [coreStart] = await core.getStartServices();

      const insightId = `agent-${params.stream_name}-${Date.now()}`;

      const body = {
        id: insightId,
        stream_name: params.stream_name,
        title: params.title,
        description: params.description,
        impact: params.impact,
        category: params.category,
        source: 'agent' as const,
        confidence: params.confidence,
        evidence: params.evidence ?? [],
        recommendations: params.recommendations ?? [],
        related_feature_uuids: params.related_feature_uuids,
        related_query_ids: params.related_query_ids,
        tags: params.tags,
        time_range: params.time_range,
      };

      const result = await callStreamsInsightCreate(
        request,
        coreStart,
        spaceId,
        params.stream_name,
        body
      );

      return {
        results: [
          createOtherResult({
            type: 'write_insight',
            data: {
              success: true,
              insight: result,
            },
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLogger.error(`write_insight failed: ${message}`);
      return {
        results: [
          createErrorResult({
            message: `Write insight failed: ${message}`,
          }),
        ],
      };
    }
  },
});
