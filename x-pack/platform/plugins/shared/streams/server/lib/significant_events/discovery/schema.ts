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
 * Lenient evidence schema used for the tool definition exposed to the LLM.
 * Uses z.string() for change_point_type so the inference layer does not reject
 * responses where the LLM sends an unexpected value (e.g. "none", "unknown").
 * Strict validation is done separately in parseDiscoveriesWithErrors.
 */
const discoveryEvidenceToolSchema = z.object({
  stream_name: z.string().describe('The name of the stream where this evidence was found'),
  query_title: z.string().describe('The title of the query that detected these events'),
  feature_name: z
    .string()
    .optional()
    .describe('The system or feature the query was generated for (e.g., kubernetes, nginx)'),
  event_count: z.number().describe('Number of events detected by this query'),
  change_point_type: z
    .string()
    .optional()
    .describe(`Type of change point detected. One of: ${CHANGE_POINT_TYPES.join(', ')}`),
  change_point_p_value: z
    .number()
    .optional()
    .describe('Statistical significance of the change point (lower = more significant)'),
});

/**
 * Lenient discovery schema used for the tool definition exposed to the LLM.
 * severity and relevance_score use broader types to avoid inference-layer
 * rejections when the LLM sends slightly out-of-range values.
 */
const discoveryToolSchema = z.object({
  title: z.string().describe('Short, actionable title summarizing the discovery'),
  description: z.string().describe('Detailed explanation of what is happening and why it matters'),
  severity: z
    .string()
    .describe(
      'Severity level: "critical" (service down), "high" (degraded), "medium" (potential issue), "low" (informational)'
    ),
  relevance_score: z
    .number()
    .describe(
      'Relevance score 0-100 based on: impact breadth (30%), evidence confidence (25%), novelty (25%), actionability (20%)'
    ),
  evidence: z
    .array(discoveryEvidenceToolSchema)
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

const discoveriesToolArgsSchema = z.object({
  discoveries: z.array(discoveryToolSchema),
});

export const discoveriesSchema = zodToJsonSchema(discoveriesToolArgsSchema, {
  $refStrategy: 'none',
}) as unknown as ToolSchema;

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
  recommendations: z.array(z.string()).optional(),
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
