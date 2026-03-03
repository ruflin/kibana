/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ToolSchema } from '@kbn/inference-common';
import { z } from '@kbn/zod';
import zodToJsonSchema from 'zod-to-json-schema';
import type { Discovery } from '@kbn/streams-schema';

export const SUBMIT_DISCOVERIES_TOOL_NAME = 'submit_discoveries';

const discoveryEvidenceZodSchema = z.object({
  stream_name: z.string().describe('The name of the stream where this evidence was found'),
  query_title: z.string().describe('The title of the query that detected these events'),
  feature_name: z
    .string()
    .optional()
    .describe('The system or feature the query was generated for (e.g., kubernetes, nginx)'),
  event_count: z.number().describe('Number of events detected by this query'),
  change_point_type: z
    .enum([
      'spike',
      'dip',
      'step_change',
      'trend_change',
      'distribution_change',
      'stationary',
      'non_stationary',
      'indeterminable',
    ])
    .optional()
    .describe('Type of change point detected'),
  change_point_p_value: z
    .number()
    .optional()
    .describe('Statistical significance of the change point (lower = more significant)'),
});

const discoveryZodSchema = z.object({
  title: z.string().describe('Short, actionable title summarizing the discovery'),
  description: z.string().describe('Detailed explanation of what is happening and why it matters'),
  severity: z
    .enum(['critical', 'high', 'medium', 'low'])
    .describe(
      'Severity level: critical (service down), high (degraded), medium (potential issue), low (informational)'
    ),
  relevance_score: z
    .number()
    .min(0)
    .max(100)
    .describe(
      'Relevance score 0-100 based on: impact breadth (30%), evidence confidence (25%), novelty (25%), actionability (20%)'
    ),
  evidence: z
    .array(discoveryEvidenceZodSchema)
    .describe('Evidence supporting this discovery from streams and queries'),
  sample_events: z
    .array(z.record(z.unknown()))
    .optional()
    .describe('Sample event payloads demonstrating the pattern'),
  recommendations: z
    .array(z.string())
    .optional()
    .describe('Actionable steps to investigate or resolve the issue'),
});

const discoveriesToolArgsZodSchema = z.object({
  discoveries: z.array(discoveryZodSchema),
});

export const discoveriesSchema = zodToJsonSchema(discoveriesToolArgsZodSchema, {
  $refStrategy: 'none',
}) as unknown as ToolSchema;

export function parseDiscoveriesWithErrors(data: unknown): {
  discoveries: Discovery[];
  errors: z.ZodError | null;
} {
  const result = discoveriesToolArgsZodSchema.safeParse(data);
  if (result.success) {
    return { discoveries: result.data.discoveries as Discovery[], errors: null };
  }
  return { discoveries: [], errors: result.error };
}
