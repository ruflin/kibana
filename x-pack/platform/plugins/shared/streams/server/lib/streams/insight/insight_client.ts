/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { termQuery } from '@kbn/es-query';
import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import type { IStorageClient } from '@kbn/storage-adapter';
import type {
  BasePersistedInsight,
  PersistedInsight,
  InsightStatus,
  InsightFeedbackEntry,
} from '@kbn/streams-schema';
import { isNotFoundError } from '@kbn/es-errors';
import { v4 as uuid } from 'uuid';
import {
  STREAM_NAME,
  INSIGHT_UUID,
  INSIGHT_ID,
  INSIGHT_TITLE,
  INSIGHT_DESCRIPTION,
  INSIGHT_IMPACT,
  INSIGHT_CATEGORY,
  INSIGHT_SOURCE,
  INSIGHT_STATUS,
  INSIGHT_CONFIDENCE,
  INSIGHT_EVIDENCE,
  INSIGHT_RECOMMENDATIONS,
  INSIGHT_RELATED_FEATURES,
  INSIGHT_RELATED_QUERIES,
  INSIGHT_RELATED_FEATURE_UUIDS,
  INSIGHT_RELATED_QUERY_IDS,
  INSIGHT_TAGS,
  INSIGHT_TIME_RANGE,
  INSIGHT_CREATED_AT,
  INSIGHT_UPDATED_AT,
  INSIGHT_EXPIRES_AT,
  INSIGHT_PARENT_INSIGHT_ID,
  INSIGHT_RELATED_INSIGHT_IDS,
  INSIGHT_FEEDBACK,
  INSIGHT_TITLE_SEMANTIC,
  INSIGHT_DESCRIPTION_SEMANTIC,
  INSIGHT_RECOMMENDATIONS_SEMANTIC,
} from './fields';
import type { InsightStorageSettings } from './storage_settings';
import type { StoredInsight } from './stored_insight';
import { StatusError } from '../errors/status_error';

export class InsightClient {
  constructor(
    private readonly clients: {
      storageClient: IStorageClient<InsightStorageSettings, StoredInsight>;
    }
  ) {}

  async clean() {
    await this.clients.storageClient.clean();
  }

  async upsert(stream: string, insight: BasePersistedInsight): Promise<PersistedInsight> {
    const now = new Date().toISOString();
    const persisted: PersistedInsight = {
      ...insight,
      uuid: uuid(),
      status: 'new',
      created_at: now,
      updated_at: now,
    };

    const document = toStorage(stream, persisted);
    await this.clients.storageClient.bulk({
      operations: [
        {
          index: {
            document,
            _id: document[INSIGHT_UUID],
          },
        },
      ],
      throwOnFail: true,
    });

    return persisted;
  }

  async bulkUpsert(stream: string, insights: BasePersistedInsight[]): Promise<PersistedInsight[]> {
    const now = new Date().toISOString();
    const persisted = insights.map((insight) => ({
      ...insight,
      uuid: uuid(),
      status: 'new' as const,
      created_at: now,
      updated_at: now,
    }));

    await this.clients.storageClient.bulk({
      operations: persisted.map((insight) => {
        const document = toStorage(stream, insight);
        return {
          index: {
            document,
            _id: document[INSIGHT_UUID],
          },
        };
      }),
      throwOnFail: true,
    });

    return persisted;
  }

  async getInsights(
    stream: string,
    filters?: {
      status?: InsightStatus;
      impact?: string;
      category?: string;
      source?: string;
      minConfidence?: number;
      limit?: number;
    }
  ): Promise<{ hits: PersistedInsight[]; total: number }> {
    const filterClauses: QueryDslQueryContainer[] = [...termQuery(STREAM_NAME, stream)];

    if (filters?.status) {
      filterClauses.push(...termQuery(INSIGHT_STATUS, filters.status));
    }
    if (filters?.impact) {
      filterClauses.push(...termQuery(INSIGHT_IMPACT, filters.impact));
    }
    if (filters?.category) {
      filterClauses.push(...termQuery(INSIGHT_CATEGORY, filters.category));
    }
    if (filters?.source) {
      filterClauses.push(...termQuery(INSIGHT_SOURCE, filters.source));
    }
    if (typeof filters?.minConfidence === 'number') {
      filterClauses.push({
        range: { [INSIGHT_CONFIDENCE]: { gte: filters.minConfidence } },
      });
    }

    const response = await this.clients.storageClient.search({
      size: filters?.limit ?? 100,
      track_total_hits: true,
      query: { bool: { filter: filterClauses } },
      sort: [{ [INSIGHT_CREATED_AT]: { order: 'desc' } }],
    });

    return {
      hits: response.hits.hits.map((hit) => fromStorage(hit._source)),
      total: response.hits.total.value,
    };
  }

  async getAllInsights(streams: string[]): Promise<{ hits: PersistedInsight[]; total: number }> {
    if (streams.length === 0) {
      return { hits: [], total: 0 };
    }

    const response = await this.clients.storageClient.search({
      size: 10_000,
      track_total_hits: true,
      query: {
        bool: {
          filter: [{ terms: { [STREAM_NAME]: streams } }],
        },
      },
      sort: [{ [INSIGHT_CREATED_AT]: { order: 'desc' } }],
    });

    return {
      hits: response.hits.hits.map((hit) => fromStorage(hit._source)),
      total: response.hits.total.value,
    };
  }

  async getInsight(stream: string, insightUuid: string): Promise<PersistedInsight> {
    const hit = await this.clients.storageClient.get({ id: insightUuid }).catch((err) => {
      if (isNotFoundError(err)) {
        throw new StatusError(`Insight ${insightUuid} not found`, 404);
      }
      throw err;
    });

    const source = hit._source!;
    if (source[STREAM_NAME] !== stream) {
      throw new StatusError(`Insight ${insightUuid} not found`, 404);
    }
    return fromStorage(source);
  }

  async updateStatus(
    stream: string,
    insightUuid: string,
    status: InsightStatus
  ): Promise<PersistedInsight> {
    const existing = await this.getInsight(stream, insightUuid);
    const updated: PersistedInsight = {
      ...existing,
      status,
      updated_at: new Date().toISOString(),
    };

    const document = toStorage(stream, updated);
    await this.clients.storageClient.bulk({
      operations: [
        {
          index: {
            document,
            _id: document[INSIGHT_UUID],
          },
        },
      ],
      throwOnFail: true,
    });

    return updated;
  }

  async addFeedback(
    stream: string,
    insightUuid: string,
    entry: InsightFeedbackEntry
  ): Promise<PersistedInsight> {
    const existing = await this.getInsight(stream, insightUuid);
    const updated: PersistedInsight = {
      ...existing,
      feedback: [...(existing.feedback ?? []), entry],
      updated_at: new Date().toISOString(),
    };

    const document = toStorage(stream, updated);
    await this.clients.storageClient.bulk({
      operations: [{ index: { document, _id: document[INSIGHT_UUID] } }],
      throwOnFail: true,
    });

    return updated;
  }

  async getInsightQuality(stream: string): Promise<{
    total: number;
    withFeedback: number;
    byAction: Record<string, number>;
    byCategory: Record<string, { total: number; helpful: number; dismissed: number }>;
    avgConfidenceByAction: Record<string, number>;
  }> {
    const { hits } = await this.getInsights(stream, { limit: 10_000 });

    const byAction: Record<string, number> = {};
    const byCategory: Record<string, { total: number; helpful: number; dismissed: number }> = {};
    const confidenceSums: Record<string, { sum: number; count: number }> = {};
    let withFeedback = 0;

    for (const insight of hits) {
      const cat = insight.category ?? 'other';
      if (!byCategory[cat]) {
        byCategory[cat] = { total: 0, helpful: 0, dismissed: 0 };
      }
      byCategory[cat].total++;

      if (insight.feedback && insight.feedback.length > 0) {
        withFeedback++;
        for (const fb of insight.feedback) {
          byAction[fb.action] = (byAction[fb.action] ?? 0) + 1;

          if (fb.action === 'helpful') {
            byCategory[cat].helpful++;
          } else if (fb.action === 'dismissed' || fb.action === 'not_helpful') {
            byCategory[cat].dismissed++;
          }

          if (!confidenceSums[fb.action]) {
            confidenceSums[fb.action] = { sum: 0, count: 0 };
          }
          confidenceSums[fb.action].sum += insight.confidence;
          confidenceSums[fb.action].count++;
        }
      }
    }

    const avgConfidenceByAction: Record<string, number> = {};
    for (const [action, { sum, count }] of Object.entries(confidenceSums)) {
      avgConfidenceByAction[action] = Math.round(sum / count);
    }

    return {
      total: hits.length,
      withFeedback,
      byAction,
      byCategory,
      avgConfidenceByAction,
    };
  }

  async linkInsights(
    stream: string,
    insightUuid: string,
    links: { parent_insight_id?: string; related_insight_ids?: string[] }
  ): Promise<PersistedInsight> {
    const existing = await this.getInsight(stream, insightUuid);
    const updated: PersistedInsight = {
      ...existing,
      parent_insight_id: links.parent_insight_id ?? existing.parent_insight_id,
      related_insight_ids: links.related_insight_ids
        ? [...new Set([...(existing.related_insight_ids ?? []), ...links.related_insight_ids])]
        : existing.related_insight_ids,
      updated_at: new Date().toISOString(),
    };

    const document = toStorage(stream, updated);
    await this.clients.storageClient.bulk({
      operations: [{ index: { document, _id: document[INSIGHT_UUID] } }],
      throwOnFail: true,
    });

    return updated;
  }

  async deleteInsight(stream: string, insightUuid: string): Promise<void> {
    await this.getInsight(stream, insightUuid);
    await this.clients.storageClient.delete({ id: insightUuid });
  }

  async deleteInsights(stream: string): Promise<void> {
    const { hits } = await this.getInsights(stream, { limit: 10_000 });
    if (hits.length === 0) return;

    await this.clients.storageClient.bulk({
      operations: hits.map((insight) => ({
        delete: { _id: insight.uuid },
      })),
    });
  }
}

function toStorage(stream: string, insight: PersistedInsight): StoredInsight {
  return {
    [INSIGHT_UUID]: insight.uuid,
    [INSIGHT_ID]: insight.id,
    [STREAM_NAME]: stream,
    [INSIGHT_TITLE]: insight.title,
    [INSIGHT_DESCRIPTION]: insight.description,
    [INSIGHT_IMPACT]: insight.impact,
    [INSIGHT_CATEGORY]: insight.category,
    [INSIGHT_SOURCE]: insight.source,
    [INSIGHT_STATUS]: insight.status,
    [INSIGHT_CONFIDENCE]: insight.confidence,
    [INSIGHT_EVIDENCE]: insight.evidence,
    [INSIGHT_RECOMMENDATIONS]: insight.recommendations,
    [INSIGHT_RELATED_FEATURES]: insight.related_features,
    [INSIGHT_RELATED_QUERIES]: insight.related_queries,
    [INSIGHT_RELATED_FEATURE_UUIDS]: insight.related_feature_uuids,
    [INSIGHT_RELATED_QUERY_IDS]: insight.related_query_ids,
    [INSIGHT_PARENT_INSIGHT_ID]: insight.parent_insight_id,
    [INSIGHT_RELATED_INSIGHT_IDS]: insight.related_insight_ids,
    [INSIGHT_FEEDBACK]: insight.feedback as Array<Record<string, unknown>>,
    [INSIGHT_TAGS]: insight.tags,
    [INSIGHT_TIME_RANGE]: insight.time_range,
    [INSIGHT_CREATED_AT]: insight.created_at,
    [INSIGHT_UPDATED_AT]: insight.updated_at,
    [INSIGHT_EXPIRES_AT]: insight.expires_at,
    [INSIGHT_TITLE_SEMANTIC]: insight.title,
    [INSIGHT_DESCRIPTION_SEMANTIC]: insight.description,
    [INSIGHT_RECOMMENDATIONS_SEMANTIC]: insight.recommendations.join('; '),
  };
}

function fromStorage(stored: StoredInsight): PersistedInsight {
  return {
    uuid: stored[INSIGHT_UUID],
    id: stored[INSIGHT_ID],
    stream_name: stored[STREAM_NAME],
    title: stored[INSIGHT_TITLE],
    description: stored[INSIGHT_DESCRIPTION],
    impact: stored[INSIGHT_IMPACT],
    category: stored[INSIGHT_CATEGORY],
    source: stored[INSIGHT_SOURCE],
    status: stored[INSIGHT_STATUS],
    confidence: stored[INSIGHT_CONFIDENCE],
    evidence: stored[INSIGHT_EVIDENCE] as PersistedInsight['evidence'],
    recommendations: stored[INSIGHT_RECOMMENDATIONS],
    related_features: stored[INSIGHT_RELATED_FEATURES],
    related_queries: stored[INSIGHT_RELATED_QUERIES],
    related_feature_uuids:
      stored[INSIGHT_RELATED_FEATURE_UUIDS] ?? stored[INSIGHT_RELATED_FEATURES],
    related_query_ids: stored[INSIGHT_RELATED_QUERY_IDS] ?? stored[INSIGHT_RELATED_QUERIES],
    parent_insight_id: stored[INSIGHT_PARENT_INSIGHT_ID],
    related_insight_ids: stored[INSIGHT_RELATED_INSIGHT_IDS],
    feedback: stored[INSIGHT_FEEDBACK] as PersistedInsight['feedback'],
    tags: stored[INSIGHT_TAGS],
    time_range: stored[INSIGHT_TIME_RANGE],
    created_at: stored[INSIGHT_CREATED_AT],
    updated_at: stored[INSIGHT_UPDATED_AT],
    expires_at: stored[INSIGHT_EXPIRES_AT],
  };
}
