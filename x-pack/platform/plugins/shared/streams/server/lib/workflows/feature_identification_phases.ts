/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SearchHit } from '@elastic/elasticsearch/lib/api/types';
import type { KibanaRequest } from '@kbn/core/server';
import type { Logger } from '@kbn/logging';
import { identifyFeatures } from '@kbn/streams-ai';
import type { ExcludedFeatureSummary } from '@kbn/streams-ai';
import { generateAllComputedFeatures } from '@kbn/streams-ai';
import type { BaseFeature, Feature, IgnoredFeature } from '@kbn/streams-schema';
import { isComputedFeature, isDuplicateFeature, isFeatureWithFilter } from '@kbn/streams-schema';
import { v4 as uuid, v5 as uuidv5 } from 'uuid';
import { fetchSampleDocuments } from '../tasks/task_definitions/features_identification/fetch_sample_documents';
import { resolveConnectorId } from '../../routes/utils/resolve_connector_id';
import { MAX_FEATURE_AGE_MS } from '../streams/feature/feature_client';
import type { GetScopedClients } from '../../routes/types';

const MAX_EXCLUDED_FEATURES_FOR_PROMPT = 10;

export interface FetchSamplesPhaseResult {
  documents: SearchHit<Record<string, unknown>>[];
  total_filters: number;
  filters_capped: boolean;
  has_filtered_documents: boolean;
}

export async function executeFetchSamplesPhase({
  getScopedClients,
  request,
  streamName,
  start,
  end,
  existingFeatures,
  logger,
}: {
  getScopedClients: GetScopedClients;
  request: KibanaRequest;
  streamName: string;
  start: number;
  end: number;
  existingFeatures: Feature[];
  logger: Logger;
}): Promise<FetchSamplesPhaseResult> {
  const { scopedClusterClient, streamsClient } = await getScopedClients({
    request,
  });

  await streamsClient.ensureStream(streamName);

  const { documents, totalFilters, filtersCapped, hasFilteredDocuments } =
    await fetchSampleDocuments({
      esClient: scopedClusterClient.asCurrentUser,
      index: streamName,
      start,
      end,
      features: existingFeatures.filter(isFeatureWithFilter),
      logger,
    });

  return {
    documents,
    total_filters: totalFilters,
    filters_capped: filtersCapped,
    has_filtered_documents: hasFilteredDocuments,
  };
}

export interface IdentifyPhaseResult {
  features: unknown[];
  ignored_features: unknown[];
  tokens_used: { prompt: number; completion: number; total: number };
}

export async function executeIdentifyPhase({
  getScopedClients,
  request,
  streamName,
  documents,
  connectorId: providedConnectorId,
  systemPrompt,
  excludedFeatures: rawExcludedFeatures,
  logger,
}: {
  getScopedClients: GetScopedClients;
  request: KibanaRequest;
  streamName: string;
  documents: Array<SearchHit<Record<string, unknown>>>;
  connectorId?: string;
  systemPrompt?: string;
  excludedFeatures?: Feature[];
  logger: Logger;
}): Promise<IdentifyPhaseResult> {
  const { inferenceClient, uiSettingsClient } = await getScopedClients({ request });

  const connectorId = await resolveConnectorId({
    connectorId: providedConnectorId,
    uiSettingsClient,
    logger,
  });

  const excludedSummaries: ExcludedFeatureSummary[] = (rawExcludedFeatures ?? [])
    .filter((f) => f.excluded_at != null)
    .slice(0, MAX_EXCLUDED_FEATURES_FOR_PROMPT)
    .map(({ id, type, subtype, title, description, properties }) => ({
      id,
      type,
      subtype,
      title,
      description,
      properties,
    }));

  const boundInferenceClient = inferenceClient.bindTo({ connectorId });

  const result = await identifyFeatures({
    streamName,
    sampleDocuments: documents,
    excludedFeatures: excludedSummaries,
    inferenceClient: boundInferenceClient,
    logger,
    signal: new AbortController().signal,
    systemPrompt: systemPrompt ?? '',
  });

  return {
    features: result.features,
    ignored_features: result.ignoredFeatures,
    tokens_used: {
      prompt: result.tokensUsed.prompt,
      completion: result.tokensUsed.completion,
      total: result.tokensUsed.total,
    },
  };
}

export async function executeComputedPhase({
  getScopedClients,
  request,
  streamName,
  start,
  end,
  logger,
}: {
  getScopedClients: GetScopedClients;
  request: KibanaRequest;
  streamName: string;
  start: number;
  end: number;
  logger: Logger;
}): Promise<{ features: unknown[] }> {
  const { scopedClusterClient, streamsClient } = await getScopedClients({ request });

  const stream = await streamsClient.getStream(streamName);

  const computedFeatures = await generateAllComputedFeatures({
    stream,
    start,
    end,
    esClient: scopedClusterClient.asCurrentUser,
    logger,
  });

  return { features: computedFeatures };
}

export interface PersistPhaseResult {
  features_count: number;
  new_features_count: number;
}

export async function executePersistPhase({
  getScopedClients,
  request,
  streamName,
  inferred_features: inferredFeatures,
  computed_features: computedFeatures,
  ignored_features: ignoredFeatures,
  logger,
}: {
  getScopedClients: GetScopedClients;
  request: KibanaRequest;
  streamName: string;
  inferred_features: BaseFeature[];
  computed_features: BaseFeature[];
  ignored_features: IgnoredFeature[];
  logger: Logger;
}): Promise<PersistPhaseResult> {
  const { featureClient } = await getScopedClients({ request });

  const { hits: existingFeatures } = await featureClient.getFeatures(streamName);
  const { hits: excludedFeatures } = await featureClient.getExcludedFeatures(streamName);

  for (const ignored of ignoredFeatures) {
    logger.debug(
      `LLM ignored feature "${ignored.feature_id}" (matched excluded "${ignored.excluded_feature_id}"): ${ignored.reason}`
    );
  }

  const nonExcludedInferredFeatures = inferredFeatures.filter((feature) => {
    const matchingExcluded = excludedFeatures.find((excluded) =>
      isDuplicateFeature(feature, excluded)
    );
    if (matchingExcluded) {
      logger.debug(
        `Dropping inferred feature [${feature.id}] because it matches excluded feature [${matchingExcluded.id}]`
      );
      return false;
    }
    return true;
  });

  const identifiedFeatures: BaseFeature[] = [...nonExcludedInferredFeatures, ...computedFeatures];

  let newFeaturesCount = nonExcludedInferredFeatures.length;
  const now = Date.now();
  const features: Feature[] = identifiedFeatures.map((feature) => {
    const existing = featureClient.findDuplicateFeature({
      existingFeatures,
      feature,
    });
    const isComputed = isComputedFeature(feature);
    if (existing && !isComputed) {
      newFeaturesCount--;
    }
    return {
      ...feature,
      status: 'active' as const,
      last_seen: new Date(now).toISOString(),
      expires_at: new Date(now + MAX_FEATURE_AGE_MS).toISOString(),
      uuid: isComputed
        ? uuidv5(`${streamName}:${feature.id}`, uuidv5.DNS)
        : existing?.uuid ?? uuid(),
    };
  });

  await featureClient.bulk(
    streamName,
    features.map((feature) => ({ index: { feature } }))
  );

  return {
    features_count: features.length,
    new_features_count: newFeaturesCount,
  };
}
