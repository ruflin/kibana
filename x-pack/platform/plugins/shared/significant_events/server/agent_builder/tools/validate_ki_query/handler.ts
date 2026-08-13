/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { QueryFeature, QueryType } from '@kbn/significant-events-schema';
import {
  deriveQueryType,
  getSourcesForStream,
  getStatsQueryHints,
  normalizeEsqlSafe,
  replaceFromSources,
  type Streams,
} from '@kbn/streams-schema';
import { computeValidationLookback, DEFAULT_QUERY_VALIDATION_TIMEOUT_MS } from '@kbn/streams-ai';
import type { KnowledgeIndicatorClient } from '../../../lib/knowledge_indicators';

export interface ValidateKiQueryInput {
  esql: string;
  title: string;
  description: string;
  category: string;
  severity_score: number;
  type?: QueryType;
  evidence?: string[];
  replaces?: string;
  feature_ids: string[];
}

export interface ValidateKiQueryResult {
  query: ValidateKiQueryInput & { type: QueryType; esql: string };
  valid: boolean;
  status: string;
  error?: string;
  hints?: string[];
  features?: QueryFeature[];
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function validateKiQueryToolHandler({
  kiClient,
  esClient,
  stream,
  queries,
  signal,
  logger,
  queryValidationTimeoutMs = DEFAULT_QUERY_VALIDATION_TIMEOUT_MS,
}: {
  kiClient: KnowledgeIndicatorClient;
  esClient: ElasticsearchClient;
  stream: Streams.all.Definition;
  queries: ValidateKiQueryInput[];
  signal: AbortSignal;
  logger: Logger;
  queryValidationTimeoutMs?: number;
}): Promise<{ queries: ValidateKiQueryResult[] }> {
  const targetSources = getSourcesForStream(stream);
  const validationLookback = await computeValidationLookback({
    esClient,
    sources: targetSources,
    signal,
    logger,
  });

  const [{ hits: features }, { [stream.name]: existingLinks = [] }] = await Promise.all([
    kiClient.getFeatures(stream.name),
    kiClient.getStreamToQueryLinksMap([stream.name]),
  ]);

  const featureMap = new Map(features.map((feature) => [feature.id, feature]));
  const normalizedStoredEsqls = new Set(
    existingLinks.map((link) => normalizeEsqlSafe(link.query.esql.query))
  );

  const queryValidationResults = await Promise.all(
    queries.map(async (query): Promise<ValidateKiQueryResult> => {
      try {
        const derivedType: QueryType = deriveQueryType(query.esql);
        const warnings: string[] = [];

        if (query.type && query.type !== derivedType) {
          warnings.push(
            `Type mismatch: declared "${query.type}" but ES|QL content is "${derivedType}". Using derived type.`
          );
        }

        const rawFeatureIds = query.feature_ids ?? [];
        const validFeatureIds: string[] = [];
        const invalidFeatureIds: string[] = [];
        for (const id of rawFeatureIds) {
          (featureMap.has(id) ? validFeatureIds : invalidFeatureIds).push(id);
        }

        if (validFeatureIds.length === 0) {
          return {
            query: { ...query, type: derivedType },
            valid: false,
            status: 'Failed to add',
            error: `feature_ids must reference at least one stored feature. Unknown IDs: [${rawFeatureIds.join(
              ', '
            )}]`,
          };
        }

        if (invalidFeatureIds.length > 0) {
          warnings.push(`Stripped unknown feature_ids: [${invalidFeatureIds.join(', ')}]`);
        }

        const queryFeatures: QueryFeature[] = validFeatureIds.map((id) => ({
          id,
          run_id: featureMap.get(id)?.run_id,
        }));

        const rewritten = replaceFromSources(query.esql, targetSources);

        if (normalizedStoredEsqls.has(normalizeEsqlSafe(rewritten))) {
          return {
            query: { ...query, type: derivedType, esql: rewritten },
            valid: false,
            status: 'Duplicate',
            error: 'This query already exists for this stream.',
          };
        }

        const hints = getStatsQueryHints(rewritten);

        await esClient.esql.query(
          {
            query: `${rewritten}\n| LIMIT 0`,
            filter: {
              range: {
                '@timestamp': {
                  gte: validationLookback,
                  lte: 'now',
                },
              },
            },
            format: 'json',
          },
          { signal, requestTimeout: queryValidationTimeoutMs }
        );

        const allHints = [...warnings, ...hints];
        return {
          query: { ...query, type: derivedType, esql: rewritten },
          valid: true,
          status: 'Added',
          hints: allHints.length > 0 ? allHints : undefined,
          features: queryFeatures,
        };
      } catch (error) {
        logger.debug(
          () => `ES|QL validation for query "${query.title}" failed: ${getErrorMessage(error)}`
        );
        return {
          query: { ...query, type: query.type ?? 'match', esql: query.esql },
          valid: false,
          status: 'Failed to add',
          error: getErrorMessage(error),
        };
      }
    })
  );

  return { queries: queryValidationResults };
}
