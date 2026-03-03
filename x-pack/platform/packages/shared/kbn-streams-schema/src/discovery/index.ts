/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ChatCompletionTokenCount } from '@kbn/inference-common';

export type DiscoverySeverity = 'critical' | 'high' | 'medium' | 'low';

export type ChangePointType =
  | 'spike'
  | 'dip'
  | 'step_change'
  | 'trend_change'
  | 'distribution_change'
  | 'stationary'
  | 'non_stationary'
  | 'indeterminable';

export interface DiscoveryEvidence {
  stream_name: string;
  query_title: string;
  feature_name?: string;
  event_count: number;
  change_point_type?: ChangePointType;
  change_point_p_value?: number;
}

export type SuggestionType = 'alert' | 'dashboard' | 'slo' | 'viz';
export type SuggestionStatus = 'pending' | 'accepted' | 'dismissed';

export interface Recommendation {
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  steps: string[];
}

export interface Discovery {
  uuid: string;
  title: string;
  description: string;
  severity: DiscoverySeverity;
  relevance_score: number;
  evidence: DiscoveryEvidence[];
  sample_events?: Record<string, unknown>[];
  recommendations?: Recommendation[];
  feature_refs?: string[];
  query_refs?: string[];
  stream_refs: string[];
  discovery_refs?: string[];
  level: number;
  created_at: string;
  updated_at: string;
  connector_id: string;
  tags?: string[];
  feedback?: 'useful' | 'not_useful' | null;
}

export interface Suggestion {
  uuid: string;
  title: string;
  description: string;
  reason: string;
  type: SuggestionType;
  esql_query: string;
  query_type?: 'row' | 'stats';
  priority: 'critical' | 'high' | 'medium' | 'low';
  discovery_refs: string[];
  stream_refs: string[];
  status: SuggestionStatus;
  created_at: string;
}

export interface DiscoveryPipelineResult {
  discoveries: Discovery[];
  suggestions: Suggestion[];
  tokensUsed: ChatCompletionTokenCount;
}
