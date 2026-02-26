/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ChatCompletionTokenCount } from '@kbn/inference-common';

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

export type InsightImpactLevel = SeverityLevel;

export interface DiscoveryEvidence {
  streamName: string;
  queryTitle: string;
  featureName?: string;
  eventCount: number;
}

export interface Discovery {
  title: string;
  description: string;
  severity: SeverityLevel;
  evidence: DiscoveryEvidence[];
  sampleEvents: string[];
}

export interface DiscoveriesResult {
  discoveries: Discovery[];
  tokensUsed: ChatCompletionTokenCount;
}

export interface InsightEvidence {
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
  discoveryRefs: number[];
}

export interface InsightsResult {
  insights: Insight[];
  tokensUsed: ChatCompletionTokenCount;
}

export interface Recommendation {
  title: string;
  description: string;
  priority: SeverityLevel;
  insightRefs: number[];
  steps: string[];
}

export interface RecommendationsResult {
  recommendations: Recommendation[];
  tokensUsed: ChatCompletionTokenCount;
}

export interface DiscoveryPipelineResult {
  discoveries: Discovery[];
  insights: Insight[];
  recommendations: Recommendation[];
  tokensUsed: ChatCompletionTokenCount;
}
