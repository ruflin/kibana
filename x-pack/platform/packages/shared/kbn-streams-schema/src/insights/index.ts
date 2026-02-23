/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import type { ChatCompletionTokenCount } from '@kbn/inference-common';

export type InsightImpactLevel = 'critical' | 'high' | 'medium' | 'low';

interface InsightEvidence {
  streamName: string;
  queryTitle: string;
  featureName?: string;
  eventCount: number;
}

export interface Insight {
  title: string;
  description: string;
  impact: InsightImpactLevel;
  evidence: InsightEvidence[];
  recommendations: string[];
}

export interface InsightsResult {
  insights: Insight[];
  tokensUsed: ChatCompletionTokenCount;
}

const insightImpactLevels = ['critical', 'high', 'medium', 'low'] as const;
export const insightImpactLevelSchema = z.enum(insightImpactLevels);

const insightSources = ['task', 'agent', 'user'] as const;
export const insightSourceSchema = z.enum(insightSources);
export type InsightSource = z.infer<typeof insightSourceSchema>;

const insightStatuses = ['new', 'acknowledged', 'resolved', 'dismissed'] as const;
export const insightStatusSchema = z.enum(insightStatuses);
export type InsightStatus = z.infer<typeof insightStatusSchema>;

const insightCategories = [
  'anomaly',
  'trend',
  'correlation',
  'error_spike',
  'performance',
  'capacity',
  'other',
] as const;
export const insightCategorySchema = z.enum(insightCategories);
export type InsightCategory = z.infer<typeof insightCategorySchema>;

export const insightEvidenceSchema = z.object({
  streamName: z.string(),
  queryTitle: z.string(),
  featureName: z.string().optional(),
  eventCount: z.number(),
});

export type InsightEvidenceInput = z.infer<typeof insightEvidenceSchema>;

export const basePersistedInsightSchema = z.object({
  id: z.string(),
  stream_name: z.string(),
  title: z.string(),
  description: z.string(),
  impact: insightImpactLevelSchema,
  category: insightCategorySchema,
  source: insightSourceSchema,
  confidence: z.number().min(0).max(100),
  evidence: z.array(insightEvidenceSchema),
  recommendations: z.array(z.string()),
  related_features: z.array(z.string()).optional(),
  related_queries: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  time_range: z.object({ start: z.string(), end: z.string() }).optional(),
});

export type BasePersistedInsight = z.infer<typeof basePersistedInsightSchema>;

export const persistedInsightSchema = basePersistedInsightSchema.and(
  z.object({
    uuid: z.string(),
    status: insightStatusSchema,
    created_at: z.string(),
    updated_at: z.string(),
    expires_at: z.string().optional(),
  })
);

export type PersistedInsight = z.infer<typeof persistedInsightSchema>;
