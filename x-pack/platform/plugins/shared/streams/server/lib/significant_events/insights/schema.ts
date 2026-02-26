/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ToolSchema } from '@kbn/inference-common';
import { z } from '@kbn/zod';
import zodToJsonSchema from 'zod-to-json-schema';
import type { Discovery, Insight, Recommendation } from '@kbn/streams-schema';

// --- Discoveries ---

export const SUBMIT_DISCOVERIES_TOOL_NAME = 'submit_discoveries';

const discoveryEvidenceZodSchema = z.object({
  streamName: z.string().describe('The name of the stream where this evidence was found'),
  queryTitle: z.string().describe('The title of the query that detected these events'),
  featureName: z
    .string()
    .optional()
    .describe('The system or feature the query was generated for (e.g., kubernetes, nginx)'),
  eventCount: z.number().describe('Number of events detected by this query'),
});

const discoveryZodSchema = z.object({
  title: z.string().describe('Short factual summary of what was observed'),
  description: z.string().describe('Detailed observation of what happened'),
  severity: z
    .enum(['critical', 'high', 'medium', 'low'])
    .describe(
      'Severity of the observed pattern: critical (service down), high (degraded), medium (potential issue), low (informational)'
    ),
  evidence: z
    .array(discoveryEvidenceZodSchema)
    .describe('Evidence supporting this discovery from streams and queries'),
  sampleEvents: z
    .array(z.string())
    .describe('Representative raw events that illustrate this discovery'),
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
    return { discoveries: result.data.discoveries, errors: null };
  }
  return { discoveries: [], errors: result.error };
}

// --- Insights ---

export const SUBMIT_INSIGHTS_TOOL_NAME = 'submit_insights';

const insightEvidenceZodSchema = z.object({
  streamName: z.string().describe('The name of the stream where this evidence was found'),
  queryTitle: z.string().describe('The title of the query that detected these events'),
  featureName: z
    .string()
    .optional()
    .describe('The system or feature the query was generated for (e.g., kubernetes, nginx)'),
  eventCount: z.number().describe('Number of events detected by this query'),
});

const insightZodSchema = z.object({
  title: z.string().describe('Short, actionable title summarizing the insight'),
  description: z
    .string()
    .describe('Detailed explanation of the analytical conclusion and why it matters'),
  impact: z
    .enum(['critical', 'high', 'medium', 'low'])
    .describe(
      'Impact level: critical (multiple services affected), high (cross-stream degradation), medium (developing issue), low (informational correlation)'
    ),
  evidence: z
    .array(insightEvidenceZodSchema)
    .describe('Evidence supporting this insight from streams and queries'),
  discoveryRefs: z
    .array(z.number())
    .describe('Indices into the discoveries array that this insight is based on'),
});

const insightsToolArgsZodSchema = z.object({
  insights: z.array(insightZodSchema),
});

export const insightsSchema = zodToJsonSchema(insightsToolArgsZodSchema, {
  $refStrategy: 'none',
}) as unknown as ToolSchema;

export function parseInsightsWithErrors(data: unknown): {
  insights: Insight[];
  errors: z.ZodError | null;
} {
  const result = insightsToolArgsZodSchema.safeParse(data);
  if (result.success) {
    return { insights: result.data.insights, errors: null };
  }
  return { insights: [], errors: result.error };
}

// --- Recommendations ---

export const SUBMIT_RECOMMENDATIONS_TOOL_NAME = 'submit_recommendations';

const recommendationZodSchema = z.object({
  title: z.string().describe('Short actionable title for this recommendation'),
  description: z.string().describe('Detailed remediation steps and context'),
  priority: z
    .enum(['critical', 'high', 'medium', 'low'])
    .describe(
      'Priority: critical (immediate action), high (urgent), medium (should address), low (consider)'
    ),
  insightRefs: z
    .array(z.number())
    .describe('Indices into the insights array that this recommendation addresses'),
  steps: z.array(z.string()).describe('Ordered action items to resolve the issue'),
});

const recommendationsToolArgsZodSchema = z.object({
  recommendations: z.array(recommendationZodSchema),
});

export const recommendationsSchema = zodToJsonSchema(recommendationsToolArgsZodSchema, {
  $refStrategy: 'none',
}) as unknown as ToolSchema;

export function parseRecommendationsWithErrors(data: unknown): {
  recommendations: Recommendation[];
  errors: z.ZodError | null;
} {
  const result = recommendationsToolArgsZodSchema.safeParse(data);
  if (result.success) {
    return { recommendations: result.data.recommendations, errors: null };
  }
  return { recommendations: [], errors: result.error };
}
