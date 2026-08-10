/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  SignificantEventsStatsResponse,
  SignificantEventsStatsTokenTotals,
} from '../../../common/stats';

export const emptyTokenTotals = (): SignificantEventsStatsTokenTotals => ({
  input: 0,
  output: 0,
  cached: 0,
  total: 0,
});

export const emptyStatsResponse = ({
  from,
  to,
  interval,
}: Pick<
  SignificantEventsStatsResponse['range'],
  'from' | 'to' | 'interval'
>): SignificantEventsStatsResponse => ({
  range: { from, to, interval },
  sources: {
    workflowsAvailable: false,
    tracingEnabled: false,
    tracesAvailable: false,
    conversationsAvailable: false,
    tokenUsageTrackingEnabled: false,
    toolCallsTruncated: false,
  },
  totals: {
    workflowRuns: 0,
    workflowRunsByStatus: {},
    tokens: emptyTokenTotals(),
    toolCalls: 0,
    toolCallErrors: 0,
    conversations: 0,
    events: 0,
    detections: 0,
    knowledgeIndicators: 0,
    memories: 0,
  },
  daily: [],
  workflowTypes: [],
  topTools: [],
});
