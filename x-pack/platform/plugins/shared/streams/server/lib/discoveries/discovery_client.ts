/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SimpleIStorageClient } from '@kbn/storage-adapter';
import type { Discovery, Suggestion } from '@kbn/streams-schema';
import type { DiscoveryStorageSettings } from './storage_settings';
import {
  DISCOVERY_UUID,
  DISCOVERY_DOC_TYPE,
  DISCOVERY_TITLE,
  DISCOVERY_TITLE_SEMANTIC,
  DISCOVERY_DESCRIPTION,
  DISCOVERY_DESCRIPTION_SEMANTIC,
  DISCOVERY_SEVERITY,
  DISCOVERY_RELEVANCE_SCORE,
  DISCOVERY_EVIDENCE,
  DISCOVERY_SAMPLE_EVENTS,
  DISCOVERY_RECOMMENDATIONS,
  DISCOVERY_RECOMMENDATIONS_TITLE_SEMANTIC,
  DISCOVERY_RECOMMENDATIONS_DESCRIPTION_SEMANTIC,
  DISCOVERY_FEATURE_REFS,
  DISCOVERY_QUERY_REFS,
  DISCOVERY_STREAM_REFS,
  DISCOVERY_DISCOVERY_REFS,
  DISCOVERY_LEVEL,
  DISCOVERY_CREATED_AT,
  DISCOVERY_UPDATED_AT,
  DISCOVERY_CONNECTOR_ID,
  DISCOVERY_TAGS,
  DISCOVERY_FEEDBACK,
  SUGGESTION_TYPE,
  SUGGESTION_ESQL_QUERY,
  SUGGESTION_ESQL_QUERY_SEMANTIC,
  SUGGESTION_QUERY_TYPE,
  SUGGESTION_REASON,
  SUGGESTION_PRIORITY,
  SUGGESTION_STATUS,
} from './fields';

type StoredDocument = Record<string, unknown>;

const buildRecommendationsSemanticText = (
  recommendations?: Discovery['recommendations']
): { titles: string; descriptions: string } => {
  if (!recommendations || recommendations.length === 0) {
    return { titles: '', descriptions: '' };
  }
  return {
    titles: recommendations.map((r) => r.title).join('\n'),
    descriptions: recommendations.map((r) => r.description).join('\n'),
  };
};

export class DiscoveryClient {
  constructor(
    private readonly clients: {
      storageClient: SimpleIStorageClient<DiscoveryStorageSettings>;
    }
  ) {}

  async createDiscovery(
    discovery: Omit<Discovery, 'uuid' | 'created_at' | 'updated_at'>
  ): Promise<Discovery> {
    const now = new Date().toISOString();
    const uuid = uuidv4();

    const cappedLevel = Math.min(discovery.level, 2);

    await this.clients.storageClient.index({
      id: uuid,
      document: {
        [DISCOVERY_UUID]: uuid,
        [DISCOVERY_DOC_TYPE]: 'discovery',
        [DISCOVERY_TITLE]: discovery.title,
        [DISCOVERY_TITLE_SEMANTIC]: discovery.title,
        [DISCOVERY_DESCRIPTION]: discovery.description,
        [DISCOVERY_DESCRIPTION_SEMANTIC]: discovery.description,
        [DISCOVERY_SEVERITY]: discovery.severity,
        [DISCOVERY_RELEVANCE_SCORE]: discovery.relevance_score,
        [DISCOVERY_EVIDENCE]: discovery.evidence,
        [DISCOVERY_SAMPLE_EVENTS]: discovery.sample_events,
        [DISCOVERY_RECOMMENDATIONS]: discovery.recommendations,
        [DISCOVERY_RECOMMENDATIONS_TITLE_SEMANTIC]: buildRecommendationsSemanticText(
          discovery.recommendations
        ).titles,
        [DISCOVERY_RECOMMENDATIONS_DESCRIPTION_SEMANTIC]: buildRecommendationsSemanticText(
          discovery.recommendations
        ).descriptions,
        [DISCOVERY_FEATURE_REFS]: discovery.feature_refs,
        [DISCOVERY_QUERY_REFS]: discovery.query_refs,
        [DISCOVERY_STREAM_REFS]: discovery.stream_refs,
        [DISCOVERY_DISCOVERY_REFS]: discovery.discovery_refs,
        [DISCOVERY_LEVEL]: cappedLevel,
        [DISCOVERY_CREATED_AT]: now,
        [DISCOVERY_UPDATED_AT]: now,
        [DISCOVERY_CONNECTOR_ID]: discovery.connector_id,
        [DISCOVERY_TAGS]: discovery.tags,
        [DISCOVERY_FEEDBACK]: discovery.feedback ?? undefined,
      },
    });

    // Write cross-references back to referenced discoveries
    if (discovery.discovery_refs && discovery.discovery_refs.length > 0) {
      await this.updateCrossReferences(uuid, discovery.discovery_refs);
    }

    return {
      ...discovery,
      level: cappedLevel,
      uuid,
      created_at: now,
      updated_at: now,
    };
  }

  async getDiscovery(uuid: string): Promise<Discovery | null> {
    try {
      const result = await this.clients.storageClient.get({ id: uuid });
      const doc = result._source as StoredDocument | undefined;
      if (!doc || doc[DISCOVERY_DOC_TYPE] !== 'discovery') {
        return null;
      }
      return this.toDiscovery(doc);
    } catch {
      return null;
    }
  }

  async searchDiscoveries(params?: {
    query?: string;
    streamName?: string;
    severity?: string;
    level?: number;
    minRelevanceScore?: number;
    size?: number;
    semanticSearch?: boolean;
  }): Promise<Discovery[]> {
    const filters: Array<Record<string, unknown>> = [
      { term: { [DISCOVERY_DOC_TYPE]: 'discovery' } },
    ];

    if (params?.streamName) {
      filters.push({ term: { [DISCOVERY_STREAM_REFS]: params.streamName } });
    }
    if (params?.severity) {
      filters.push({ term: { [DISCOVERY_SEVERITY]: params.severity } });
    }
    if (params?.level !== undefined) {
      filters.push({ term: { [DISCOVERY_LEVEL]: params.level } });
    }
    if (params?.minRelevanceScore !== undefined) {
      filters.push({
        range: { [DISCOVERY_RELEVANCE_SCORE]: { gte: params.minRelevanceScore } },
      });
    }

    const useSemanticSearch = params?.semanticSearch && params?.query;

    const response = await this.clients.storageClient.search({
      size: params?.size ?? 50,
      track_total_hits: false,
      query: useSemanticSearch
        ? {
            bool: {
              filter: filters,
              should: [
                { semantic: { field: DISCOVERY_TITLE_SEMANTIC, query: params!.query! } },
                { semantic: { field: DISCOVERY_DESCRIPTION_SEMANTIC, query: params!.query! } },
              ],
              minimum_should_match: 1,
            },
          }
        : {
            bool: {
              filter: filters,
            },
          },
      sort: useSemanticSearch
        ? undefined
        : [{ [DISCOVERY_RELEVANCE_SCORE]: { order: 'desc' as const } }],
    });

    return response.hits.hits.map((hit) => this.toDiscovery((hit._source ?? {}) as StoredDocument));
  }

  async updateDiscovery(uuid: string, updates: Partial<Discovery>): Promise<void> {
    const existing = await this.clients.storageClient.get({ id: uuid });
    const doc = (existing._source ?? {}) as StoredDocument;
    if (doc[DISCOVERY_DOC_TYPE] !== 'discovery') {
      return;
    }

    const merged: StoredDocument = {
      ...doc,
      [DISCOVERY_UPDATED_AT]: new Date().toISOString(),
    };

    if (updates.title !== undefined) {
      merged[DISCOVERY_TITLE] = updates.title;
      merged[DISCOVERY_TITLE_SEMANTIC] = updates.title;
    }
    if (updates.description !== undefined) {
      merged[DISCOVERY_DESCRIPTION] = updates.description;
      merged[DISCOVERY_DESCRIPTION_SEMANTIC] = updates.description;
    }
    if (updates.severity !== undefined) merged[DISCOVERY_SEVERITY] = updates.severity;
    if (updates.relevance_score !== undefined)
      merged[DISCOVERY_RELEVANCE_SCORE] = updates.relevance_score;
    if (updates.recommendations !== undefined) {
      merged[DISCOVERY_RECOMMENDATIONS] = updates.recommendations;
      const semanticText = buildRecommendationsSemanticText(updates.recommendations);
      merged[DISCOVERY_RECOMMENDATIONS_TITLE_SEMANTIC] = semanticText.titles;
      merged[DISCOVERY_RECOMMENDATIONS_DESCRIPTION_SEMANTIC] = semanticText.descriptions;
    }
    if (updates.tags !== undefined) merged[DISCOVERY_TAGS] = updates.tags;
    if (updates.feedback !== undefined) merged[DISCOVERY_FEEDBACK] = updates.feedback;

    await this.clients.storageClient.index({
      id: uuid,
      document: merged,
    });
  }

  async deleteDiscovery(uuid: string): Promise<void> {
    await this.clients.storageClient.delete({ id: uuid });
  }

  async createSuggestion(suggestion: Omit<Suggestion, 'uuid' | 'created_at'>): Promise<Suggestion> {
    // Deduplication: check if an identical ES|QL query already exists
    const existing = await this.deduplicateSuggestion(
      suggestion.esql_query,
      suggestion.discovery_refs
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    const uuid = uuidv4();

    await this.clients.storageClient.index({
      id: uuid,
      document: {
        [DISCOVERY_UUID]: uuid,
        [DISCOVERY_DOC_TYPE]: 'suggestion',
        [DISCOVERY_TITLE]: suggestion.title,
        [DISCOVERY_TITLE_SEMANTIC]: suggestion.title,
        [DISCOVERY_DESCRIPTION]: suggestion.description,
        [DISCOVERY_DESCRIPTION_SEMANTIC]: suggestion.description,
        [SUGGESTION_TYPE]: suggestion.type,
        [SUGGESTION_ESQL_QUERY]: suggestion.esql_query,
        [SUGGESTION_ESQL_QUERY_SEMANTIC]: suggestion.esql_query,
        [SUGGESTION_QUERY_TYPE]: suggestion.query_type,
        [SUGGESTION_REASON]: suggestion.reason,
        [SUGGESTION_PRIORITY]: suggestion.priority,
        [DISCOVERY_STREAM_REFS]: suggestion.stream_refs,
        [DISCOVERY_DISCOVERY_REFS]: suggestion.discovery_refs,
        [SUGGESTION_STATUS]: suggestion.status,
        [DISCOVERY_CREATED_AT]: now,
      },
    });

    return {
      ...suggestion,
      uuid,
      created_at: now,
    };
  }

  async searchSuggestions(params?: {
    type?: string;
    status?: string;
    priority?: string;
    size?: number;
  }): Promise<Suggestion[]> {
    const filters: Array<Record<string, unknown>> = [
      { term: { [DISCOVERY_DOC_TYPE]: 'suggestion' } },
    ];

    if (params?.type) {
      filters.push({ term: { [SUGGESTION_TYPE]: params.type } });
    }
    if (params?.status) {
      filters.push({ term: { [SUGGESTION_STATUS]: params.status } });
    }
    if (params?.priority) {
      filters.push({ term: { [SUGGESTION_PRIORITY]: params.priority } });
    }

    const response = await this.clients.storageClient.search({
      size: params?.size ?? 50,
      track_total_hits: false,
      query: {
        bool: {
          filter: filters,
        },
      },
      sort: [{ [DISCOVERY_CREATED_AT]: { order: 'desc' as const } }],
    });

    return response.hits.hits.map((hit) =>
      this.toSuggestion((hit._source ?? {}) as StoredDocument)
    );
  }

  async updateSuggestionStatus(uuid: string, status: 'accepted' | 'dismissed'): Promise<void> {
    const existing = await this.clients.storageClient.get({ id: uuid });
    const doc = (existing._source ?? {}) as StoredDocument;
    if (doc[DISCOVERY_DOC_TYPE] !== 'suggestion') {
      return;
    }

    await this.clients.storageClient.index({
      id: uuid,
      document: { ...doc, [SUGGESTION_STATUS]: status },
    });
  }

  private async updateCrossReferences(
    newDiscoveryUuid: string,
    referencedDiscoveryUuids: string[]
  ): Promise<void> {
    for (const refUuid of referencedDiscoveryUuids) {
      try {
        const existing = await this.clients.storageClient.get({ id: refUuid });
        const doc = (existing._source ?? {}) as StoredDocument;
        if (doc[DISCOVERY_DOC_TYPE] !== 'discovery') continue;

        const existingRefs = (doc[DISCOVERY_DISCOVERY_REFS] as string[]) ?? [];
        if (existingRefs.includes(newDiscoveryUuid)) continue;

        await this.clients.storageClient.index({
          id: refUuid,
          document: {
            ...doc,
            [DISCOVERY_DISCOVERY_REFS]: [...existingRefs, newDiscoveryUuid],
            [DISCOVERY_UPDATED_AT]: new Date().toISOString(),
          },
        });
      } catch {
        // Referenced discovery may not exist; skip silently (lazy cleanup)
      }
    }
  }

  async deduplicateSuggestion(
    esqlQuery: string,
    newDiscoveryRefs: string[]
  ): Promise<Suggestion | null> {
    const response = await this.clients.storageClient.search({
      size: 1,
      track_total_hits: false,
      query: {
        bool: {
          filter: [
            { term: { [DISCOVERY_DOC_TYPE]: 'suggestion' } },
            { term: { [SUGGESTION_ESQL_QUERY]: esqlQuery } },
          ],
        },
      },
    });

    if (response.hits.hits.length === 0) return null;

    const hit = response.hits.hits[0];
    const doc = (hit._source ?? {}) as StoredDocument;
    const existingRefs = (doc[DISCOVERY_DISCOVERY_REFS] as string[]) ?? [];
    const mergedRefs = [...new Set([...existingRefs, ...newDiscoveryRefs])];

    await this.clients.storageClient.index({
      id: hit._id!,
      document: {
        ...doc,
        [DISCOVERY_DISCOVERY_REFS]: mergedRefs,
      },
    });

    return this.toSuggestion({ ...doc, [DISCOVERY_DISCOVERY_REFS]: mergedRefs });
  }

  private toDiscovery(doc: StoredDocument): Discovery {
    return {
      uuid: doc[DISCOVERY_UUID] as string,
      title: doc[DISCOVERY_TITLE] as string,
      description: doc[DISCOVERY_DESCRIPTION] as string,
      severity: doc[DISCOVERY_SEVERITY] as Discovery['severity'],
      relevance_score: doc[DISCOVERY_RELEVANCE_SCORE] as number,
      evidence: (doc[DISCOVERY_EVIDENCE] as Discovery['evidence']) ?? [],
      sample_events: doc[DISCOVERY_SAMPLE_EVENTS] as Discovery['sample_events'],
      recommendations: doc[DISCOVERY_RECOMMENDATIONS] as Discovery['recommendations'],
      feature_refs: doc[DISCOVERY_FEATURE_REFS] as string[] | undefined,
      query_refs: doc[DISCOVERY_QUERY_REFS] as string[] | undefined,
      stream_refs: (doc[DISCOVERY_STREAM_REFS] as string[]) ?? [],
      discovery_refs: doc[DISCOVERY_DISCOVERY_REFS] as string[] | undefined,
      level: doc[DISCOVERY_LEVEL] as number,
      created_at: doc[DISCOVERY_CREATED_AT] as string,
      updated_at: doc[DISCOVERY_UPDATED_AT] as string,
      connector_id: doc[DISCOVERY_CONNECTOR_ID] as string,
      tags: doc[DISCOVERY_TAGS] as string[] | undefined,
      feedback: doc[DISCOVERY_FEEDBACK] as Discovery['feedback'],
    };
  }

  private toSuggestion(doc: StoredDocument): Suggestion {
    return {
      uuid: doc[DISCOVERY_UUID] as string,
      title: doc[DISCOVERY_TITLE] as string,
      description: doc[DISCOVERY_DESCRIPTION] as string,
      reason: doc[SUGGESTION_REASON] as string,
      type: doc[SUGGESTION_TYPE] as Suggestion['type'],
      esql_query: doc[SUGGESTION_ESQL_QUERY] as string,
      query_type: doc[SUGGESTION_QUERY_TYPE] as Suggestion['query_type'],
      priority: doc[SUGGESTION_PRIORITY] as Suggestion['priority'],
      discovery_refs: (doc[DISCOVERY_DISCOVERY_REFS] as string[]) ?? [],
      stream_refs: (doc[DISCOVERY_STREAM_REFS] as string[]) ?? [],
      status: doc[SUGGESTION_STATUS] as Suggestion['status'],
      created_at: doc[DISCOVERY_CREATED_AT] as string,
    };
  }
}
