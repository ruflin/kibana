/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ChatCompletionTokenCount } from '@kbn/inference-common';
import type { DiscoverySeverity } from '../discovery';

/**
 * @deprecated Use Discovery instead
 */
export type InsightImpactLevel = DiscoverySeverity;

/**
 * @deprecated Use Discovery instead
 */
export interface Insight {
  title: string;
  description: string;
  impact: InsightImpactLevel;
  evidence: Array<{
    streamName: string;
    queryTitle: string;
    featureName?: string;
    eventCount: number;
  }>;
  recommendations: string[];
}

/**
 * @deprecated Use DiscoveryPipelineResult instead
 */
export interface InsightsResult {
  insights: Insight[];
  tokensUsed: ChatCompletionTokenCount;
}
