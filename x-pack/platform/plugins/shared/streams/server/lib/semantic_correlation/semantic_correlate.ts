/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import type { Logger } from '@kbn/logging';
import {
  FEATURE_DESCRIPTION,
  FEATURE_DESCRIPTION_SEMANTIC,
  FEATURE_EVIDENCE_SEMANTIC,
  FEATURE_PROPERTIES_SUMMARY,
  FEATURE_ID,
  FEATURE_TITLE,
  FEATURE_TYPE,
  FEATURE_SUBTYPE,
  STREAM_NAME,
} from '../streams/feature/fields';
import { QUERY_TITLE_SEMANTIC, QUERY_KQL_BODY_SEMANTIC } from '../streams/assets/fields';
import {
  INSIGHT_ID,
  INSIGHT_TITLE,
  INSIGHT_DESCRIPTION,
  INSIGHT_IMPACT,
  INSIGHT_CATEGORY,
  INSIGHT_TITLE_SEMANTIC,
  INSIGHT_DESCRIPTION_SEMANTIC,
  INSIGHT_RECOMMENDATIONS_SEMANTIC,
  STREAM_NAME as INSIGHT_STREAM_NAME,
} from '../streams/insight/fields';
import type {
  CorrelatedFeatureHit,
  CorrelatedQueryHit,
  CorrelatedInsightHit,
  SemanticCorrelateResponse,
} from './types';

const FEATURES_INDEX_PATTERN = '.kibana_streams_features*';
const ASSETS_INDEX_PATTERN = '.kibana_streams_assets';
const INSIGHTS_INDEX_PATTERN = '.kibana_streams_insights';

const FEATURE_SEMANTIC_FIELDS = [
  FEATURE_DESCRIPTION_SEMANTIC,
  FEATURE_EVIDENCE_SEMANTIC,
  FEATURE_PROPERTIES_SUMMARY,
];

const ASSETS_SEMANTIC_FIELDS = [QUERY_TITLE_SEMANTIC, QUERY_KQL_BODY_SEMANTIC];

const INSIGHT_SEMANTIC_FIELDS = [
  INSIGHT_TITLE_SEMANTIC,
  INSIGHT_DESCRIPTION_SEMANTIC,
  INSIGHT_RECOMMENDATIONS_SEMANTIC,
];

export interface SemanticCorrelateParams {
  query: string;
  stream?: string;
  size?: number;
  includeQueries?: boolean;
  includeInsights?: boolean;
}

/**
 * Runs semantic search over features (and optionally assets) and returns ranked hits.
 * Uses the same retriever (RRF) pattern as Agent Builder search for semantic_text fields.
 */
export async function semanticCorrelate(
  esClient: ElasticsearchClient,
  params: SemanticCorrelateParams,
  logger: Logger
): Promise<SemanticCorrelateResponse> {
  const { query, stream, size = 10, includeQueries = false, includeInsights = false } = params;

  const featuresFilter = stream ? { term: { [STREAM_NAME]: stream } } : { match_all: {} };

  const searchRequest: Record<string, unknown> = {
    index: FEATURES_INDEX_PATTERN,
    size,
    retriever: {
      rrf: {
        retrievers: FEATURE_SEMANTIC_FIELDS.map((field) => ({
          standard: {
            query: {
              bool: {
                filter: [featuresFilter],
                must: [{ semantic: { field, query } }],
              },
            },
          },
        })),
        rank_window_size: size * 2,
      },
    },
    _source: [
      FEATURE_ID,
      STREAM_NAME,
      FEATURE_TITLE,
      FEATURE_TYPE,
      FEATURE_SUBTYPE,
      FEATURE_DESCRIPTION,
    ],
  };

  let features: CorrelatedFeatureHit[] = [];
  try {
    const response = await esClient.search<{
      [FEATURE_ID]: string;
      [STREAM_NAME]: string;
      [FEATURE_TITLE]: string;
      [FEATURE_TYPE]: string;
      [FEATURE_SUBTYPE]?: string;
      [FEATURE_DESCRIPTION]: string;
    }>(searchRequest as any);

    features = (response.hits.hits ?? []).map((hit) => {
      const s = hit._source ?? {};
      return {
        id: s[FEATURE_ID],
        stream_name: s[STREAM_NAME],
        title: s[FEATURE_TITLE],
        type: s[FEATURE_TYPE],
        subtype: s[FEATURE_SUBTYPE],
        description: s[FEATURE_DESCRIPTION] ?? '',
        score: (hit as any)._score,
      };
    });
  } catch (err) {
    logger.warn(`Semantic correlate (features) failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let queries: CorrelatedQueryHit[] | undefined;
  if (includeQueries) {
    const assetsFilter = stream ? { term: { 'stream.name': stream } } : { match_all: {} };
    const assetsSearchRequest: Record<string, unknown> = {
      index: ASSETS_INDEX_PATTERN,
      size,
      retriever: {
        rrf: {
          retrievers: ASSETS_SEMANTIC_FIELDS.map((field) => ({
            standard: {
              query: {
                bool: {
                  filter: [assetsFilter],
                  must: [{ semantic: { field, query } }],
                },
              },
            },
          })),
          rank_window_size: size * 2,
        },
      },
      _source: ['asset.id', 'stream.name', 'query.title', 'query.kql.query'],
    };

    try {
      const assetsResponse = await esClient.search<{
        'asset.id': string;
        'stream.name': string;
        'query.title': string;
        'query.kql.query': string;
      }>(assetsSearchRequest as any);

      queries = (assetsResponse.hits.hits ?? []).map((hit) => {
        const s = hit._source ?? {};
        return {
          asset_id: s['asset.id'],
          stream_name: s['stream.name'],
          title: s['query.title'],
          kql_body: s['query.kql.query'] ?? '',
          score: (hit as any)._score,
        };
      });
    } catch (err) {
      logger.warn(`Semantic correlate (queries) failed: ${err instanceof Error ? err.message : String(err)}`);
      queries = [];
    }
  }

  let insights: CorrelatedInsightHit[] | undefined;
  if (includeInsights) {
    const insightsFilter = stream
      ? { term: { [INSIGHT_STREAM_NAME]: stream } }
      : { match_all: {} };
    const insightsSearchRequest: Record<string, unknown> = {
      index: INSIGHTS_INDEX_PATTERN,
      size,
      retriever: {
        rrf: {
          retrievers: INSIGHT_SEMANTIC_FIELDS.map((field) => ({
            standard: {
              query: {
                bool: {
                  filter: [insightsFilter],
                  must: [{ semantic: { field, query } }],
                },
              },
            },
          })),
          rank_window_size: size * 2,
        },
      },
      _source: [
        INSIGHT_ID,
        INSIGHT_STREAM_NAME,
        INSIGHT_TITLE,
        INSIGHT_DESCRIPTION,
        INSIGHT_IMPACT,
        INSIGHT_CATEGORY,
      ],
    };

    try {
      const insightsResponse = await esClient.search<{
        [INSIGHT_ID]: string;
        [INSIGHT_STREAM_NAME]: string;
        [INSIGHT_TITLE]: string;
        [INSIGHT_DESCRIPTION]: string;
        [INSIGHT_IMPACT]: string;
        [INSIGHT_CATEGORY]: string;
      }>(insightsSearchRequest as any);

      insights = (insightsResponse.hits.hits ?? []).map((hit) => {
        const s = hit._source ?? {};
        return {
          id: s[INSIGHT_ID],
          stream_name: s[INSIGHT_STREAM_NAME],
          title: s[INSIGHT_TITLE],
          description: s[INSIGHT_DESCRIPTION] ?? '',
          impact: s[INSIGHT_IMPACT] ?? '',
          category: s[INSIGHT_CATEGORY] ?? '',
          score: (hit as any)._score,
        };
      });
    } catch (err) {
      logger.warn(
        `Semantic correlate (insights) failed: ${err instanceof Error ? err.message : String(err)}`
      );
      insights = [];
    }
  }

  return { features, queries, insights };
}
