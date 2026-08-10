/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, IUiSettingsClient } from '@kbn/core/server';
import {
  AGENT_BUILDER_TRACING_ENABLED_SETTING_ID,
  GEN_AI_SETTINGS_TOKEN_USAGE_TRACKING,
} from '@kbn/management-settings-ids';
import type {
  SignificantEventsStatsDailyBucket,
  SignificantEventsStatsInterval,
  SignificantEventsStatsResponse,
} from '../../../common/stats';
import { emptyStatsResponse, emptyTokenTotals } from './empty_stats';
import { queryArtifactStats } from './query_artifact_stats';
import { queryConversationStats } from './query_conversation_stats';
import { queryToolStats } from './query_tool_stats';
import { queryWorkflowStats } from './query_workflow_stats';

const readBooleanSetting = async (
  uiSettingsClient: IUiSettingsClient,
  key: string,
  fallback: boolean
): Promise<boolean> => {
  try {
    const value = await uiSettingsClient.get<boolean>(key);
    return typeof value === 'boolean' ? value : fallback;
  } catch {
    return fallback;
  }
};

const mergeDailyBuckets = ({
  workflowDaily,
  toolDaily,
  conversationDaily,
  artifactDaily,
}: {
  workflowDaily: Array<{
    date: string;
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    tokens: SignificantEventsStatsDailyBucket['workflowRuns']['tokens'];
  }>;
  toolDaily: Array<{
    date: string;
    total: number;
    errors: number;
    byTool: Record<string, number>;
  }>;
  conversationDaily: Array<{
    date: string;
    total: number;
    byAgent: Record<string, number>;
  }>;
  artifactDaily: Array<{
    date: string;
    events: number;
    detections: number;
    knowledgeIndicators: number;
    memories: number;
  }>;
}): SignificantEventsStatsDailyBucket[] => {
  const dates = new Set<string>();
  for (const row of workflowDaily) dates.add(row.date);
  for (const row of toolDaily) dates.add(row.date);
  for (const row of conversationDaily) dates.add(row.date);
  for (const row of artifactDaily) dates.add(row.date);

  const workflowByDate = new Map(workflowDaily.map((row) => [row.date, row]));
  const toolByDate = new Map(toolDaily.map((row) => [row.date, row]));
  const conversationByDate = new Map(conversationDaily.map((row) => [row.date, row]));
  const artifactByDate = new Map(artifactDaily.map((row) => [row.date, row]));

  return Array.from(dates)
    .sort((a, b) => a.localeCompare(b))
    .map((date) => {
      const workflow = workflowByDate.get(date);
      const tools = toolByDate.get(date);
      const conversations = conversationByDate.get(date);
      const artifacts = artifactByDate.get(date);

      return {
        date,
        workflowRuns: {
          total: workflow?.total ?? 0,
          byType: workflow?.byType ?? {},
          byStatus: workflow?.byStatus ?? {},
          tokens: workflow?.tokens ?? emptyTokenTotals(),
        },
        toolCalls: {
          total: tools?.total ?? 0,
          errors: tools?.errors ?? 0,
          byTool: tools?.byTool ?? {},
        },
        conversations: {
          total: conversations?.total ?? 0,
          byAgent: conversations?.byAgent ?? {},
        },
        artifacts: {
          events: artifacts?.events ?? 0,
          detections: artifacts?.detections ?? 0,
          knowledgeIndicators: artifacts?.knowledgeIndicators ?? 0,
          memories: artifacts?.memories ?? 0,
        },
      };
    });
};

export const getStatsForRange = async ({
  esClient,
  uiSettingsClient,
  spaceId,
  from,
  to,
  interval,
}: {
  esClient: ElasticsearchClient;
  uiSettingsClient: IUiSettingsClient;
  spaceId: string;
  from: string;
  to: string;
  interval: SignificantEventsStatsInterval;
}): Promise<SignificantEventsStatsResponse> => {
  const [tracingEnabled, tokenUsageTrackingEnabled] = await Promise.all([
    readBooleanSetting(uiSettingsClient, AGENT_BUILDER_TRACING_ENABLED_SETTING_ID, true),
    readBooleanSetting(uiSettingsClient, GEN_AI_SETTINGS_TOKEN_USAGE_TRACKING, false),
  ]);

  const [workflows, tools, conversations, artifacts] = await Promise.all([
    queryWorkflowStats({ esClient, spaceId, from, to, interval }),
    queryToolStats({ esClient, spaceId, from, to, interval, tracingEnabled }),
    queryConversationStats({ esClient, spaceId, from, to, interval }),
    queryArtifactStats({ esClient, spaceId, from, to, interval }),
  ]);

  const base = emptyStatsResponse({ from, to, interval });

  return {
    ...base,
    sources: {
      workflowsAvailable: workflows.available,
      tracingEnabled,
      tracesAvailable: tools.available,
      conversationsAvailable: conversations.available,
      tokenUsageTrackingEnabled,
      toolCallsTruncated: tools.truncated,
    },
    totals: {
      workflowRuns: workflows.totals.workflowRuns,
      workflowRunsByStatus: workflows.totals.workflowRunsByStatus,
      tokens: workflows.totals.tokens,
      toolCalls: tools.total,
      toolCallErrors: tools.errors,
      conversations: conversations.total,
      events: artifacts.totals.events,
      detections: artifacts.totals.detections,
      knowledgeIndicators: artifacts.totals.knowledgeIndicators,
      memories: artifacts.totals.memories,
    },
    daily: mergeDailyBuckets({
      workflowDaily: workflows.daily,
      toolDaily: tools.daily,
      conversationDaily: conversations.daily,
      artifactDaily: artifacts.daily,
    }),
    workflowTypes: workflows.workflowTypes,
    topTools: tools.topTools,
  };
};
