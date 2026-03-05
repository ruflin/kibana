/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ToolSchema } from '@kbn/inference-common';
import { z } from '@kbn/zod';
import type { Discovery } from '@kbn/streams-schema';

export const SUBMIT_DISCOVERIES_TOOL_NAME = 'submit_discoveries';

const CHANGE_POINT_TYPES = [
  'spike',
  'dip',
  'step_change',
  'trend_change',
  'distribution_change',
  'stationary',
  'non_stationary',
  'indeterminable',
] as const;

/**
 * Raw JSON Schema for the submit_discoveries tool definition exposed to the LLM.
 * Written directly (not via zodToJsonSchema) to avoid round-trip issues where
 * @n8n/json-schema-to-zod re-interprets the schema more strictly than intended.
 * All optional fields accept null to handle LLM responses that use null instead
 * of omitting the field.
 */
export const discoveriesSchema: ToolSchema = {
  type: 'object',
  properties: {
    discoveries: {
      type: 'array',
      description: 'List of significant discoveries identified from the data streams',
      items: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short, actionable title summarizing the discovery',
          },
          description: {
            type: 'string',
            description: 'Detailed explanation of what is happening and why it matters',
          },
          severity: {
            type: 'string',
            description:
              'Severity level: "critical" (service down), "high" (degraded), "medium" (potential issue), "low" (informational)',
          },
          relevance_score: {
            type: 'number',
            description:
              'Relevance score 0-100 based on: impact breadth (30%), evidence confidence (25%), novelty (25%), actionability (20%)',
          },
          evidence: {
            type: 'array',
            description: 'Evidence supporting this discovery from streams and queries',
            items: {
              type: 'object',
              properties: {
                stream_name: {
                  type: 'string',
                  description: 'The name of the stream where this evidence was found',
                },
                query_title: {
                  type: 'string',
                  description: 'The title of the query that detected these events',
                },
                feature_name: {
                  type: 'string',
                  description:
                    'The system or feature the query was generated for (e.g., kubernetes, nginx)',
                },
                event_count: {
                  type: 'number',
                  description: 'Number of events detected by this query',
                },
                change_point_type: {
                  type: 'string',
                  description: `Type of change point detected. One of: ${CHANGE_POINT_TYPES.join(', ')}`,
                },
                change_point_p_value: {
                  type: 'number',
                  description:
                    'Statistical significance of the change point (lower = more significant)',
                },
              },
              required: ['stream_name', 'query_title', 'event_count'],
            },
          },
          sample_events: {
            type: 'array',
            description: 'Sample event payloads demonstrating the pattern',
            items: { type: 'object', properties: {} },
          },
          recommendations: {
            type: 'array',
            description: 'Actionable recommendations to investigate or resolve the issue',
            items: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description:
                    'Short, descriptive title for the recommendation (plain text, no markdown). Example: "Scale up payment service replicas"',
                },
                description: {
                  type: 'string',
                  description:
                    'Detailed explanation with investigation steps, commands, or queries. Use markdown formatting for code blocks, lists, and emphasis.',
                },
                priority: {
                  type: 'string',
                  description:
                    'Priority: "critical", "high", "medium", or "low"',
                },
              },
              required: ['title', 'description'],
            },
          },
        },
        required: ['title', 'description', 'severity', 'relevance_score'],
      },
    },
  },
  required: ['discoveries'],
};

/**
 * Strict evidence schema used when parsing the LLM response after it passes
 * the inference-layer validation. Coerces unknown change_point_type values to
 * undefined rather than failing the whole parse.
 */
const discoveryEvidenceStrictSchema = z.object({
  stream_name: z.string(),
  query_title: z.string(),
  feature_name: z.string().optional(),
  event_count: z.number(),
  change_point_type: z
    .string()
    .optional()
    .transform((val) =>
      val && (CHANGE_POINT_TYPES as readonly string[]).includes(val)
        ? (val as (typeof CHANGE_POINT_TYPES)[number])
        : undefined
    ),
  change_point_p_value: z.number().optional(),
});

const discoveryStrictSchema = z.object({
  title: z.string(),
  description: z.string(),
  severity: z
    .string()
    .transform((val) =>
      (['critical', 'high', 'medium', 'low'] as const).includes(
        val as 'critical' | 'high' | 'medium' | 'low'
      )
        ? (val as 'critical' | 'high' | 'medium' | 'low')
        : ('medium' as const)
    ),
  relevance_score: z.number().min(0).max(100).catch(50),
  evidence: z.array(discoveryEvidenceStrictSchema).default([]),
  sample_events: z.array(z.record(z.unknown())).optional(),
  recommendations: z
    .array(
      z.union([
        z.object({
          title: z.string(),
          description: z.string(),
          priority: z.string().optional(),
          steps: z.array(z.string()).optional(),
        }),
        z.string().transform((s) => ({
          title: s,
          description: s,
          priority: 'medium' as const,
          steps: [] as string[],
        })),
      ])
    )
    .optional(),
});

const discoveriesStrictArgsSchema = z.object({
  discoveries: z.array(discoveryStrictSchema),
});

export function parseDiscoveriesWithErrors(data: unknown): {
  discoveries: Discovery[];
  errors: z.ZodError | null;
} {
  const result = discoveriesStrictArgsSchema.safeParse(data);
  if (result.success) {
    return { discoveries: result.data.discoveries as Discovery[], errors: null };
  }
  return { discoveries: [], errors: result.error };
}
