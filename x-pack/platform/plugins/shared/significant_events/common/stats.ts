/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export type SignificantEventsStatsInterval = '1h' | '1d';

export interface SignificantEventsStatsTokenTotals {
  input: number;
  output: number;
  cached: number;
  total: number;
}

export interface SignificantEventsStatsSources {
  workflowsAvailable: boolean;
  tracingEnabled: boolean;
  tracesAvailable: boolean;
  conversationsAvailable: boolean;
  tokenUsageTrackingEnabled: boolean;
  toolCallsTruncated: boolean;
}

export interface SignificantEventsStatsWorkflowTypeRow {
  workflowId: string;
  runs: number;
  byStatus: Record<string, number>;
  tokens: SignificantEventsStatsTokenTotals;
}

export interface SignificantEventsStatsToolRow {
  toolId: string;
  calls: number;
  errors: number;
}

export interface SignificantEventsStatsDailyBucket {
  date: string;
  workflowRuns: {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    tokens: SignificantEventsStatsTokenTotals;
  };
  toolCalls: {
    total: number;
    errors: number;
    byTool: Record<string, number>;
  };
  conversations: {
    total: number;
    byAgent: Record<string, number>;
  };
  artifacts: {
    events: number;
    detections: number;
    knowledgeIndicators: number;
    memories: number;
  };
}

export interface SignificantEventsStatsResponse {
  range: {
    from: string;
    to: string;
    interval: SignificantEventsStatsInterval;
  };
  sources: SignificantEventsStatsSources;
  totals: {
    workflowRuns: number;
    workflowRunsByStatus: Record<string, number>;
    tokens: SignificantEventsStatsTokenTotals;
    toolCalls: number;
    toolCallErrors: number;
    conversations: number;
    events: number;
    detections: number;
    knowledgeIndicators: number;
    memories: number;
  };
  daily: SignificantEventsStatsDailyBucket[];
  workflowTypes: SignificantEventsStatsWorkflowTypeRow[];
  topTools: SignificantEventsStatsToolRow[];
}
