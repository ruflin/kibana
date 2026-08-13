/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import {
  identifiedFeatureSchema,
  ignoredFeatureSchema,
  isComputedFeature,
  normalizeFeatureSlug,
  type BaseFeature,
  type IgnoredFeature,
} from '@kbn/significant-events-schema';
import { conditionSchema, isConditionComplete, type Condition } from '@kbn/streamlang';
import type { KnowledgeIndicatorClient } from '../../../lib/knowledge_indicators';
import {
  reconcileInferredFeatures,
  toFeatureSummary,
} from '../../../lib/significant_events/features/reconcile_features';

const MAX_EVIDENCE_ITEMS = 5;

export interface PersistFeaturesParams {
  streamName: string;
  runId: string;
  features: Array<
    Omit<BaseFeature, 'stream_name' | 'filter'> & {
      filter?: unknown;
    }
  >;
  ignoredFeatures?: IgnoredFeature[];
}

function tryParseFilter(maybeFilter: unknown): Condition | undefined {
  if (!maybeFilter) {
    return undefined;
  }
  const result = conditionSchema.safeParse(maybeFilter);
  if (!result.success) {
    return undefined;
  }
  return isConditionComplete(result.data) ? result.data : undefined;
}

export async function persistFeaturesToolHandler({
  kiClient,
  streamName,
  runId,
  features,
  ignoredFeatures = [],
  logger,
}: {
  kiClient: KnowledgeIndicatorClient;
  logger: Logger;
} & PersistFeaturesParams): Promise<{
  newFeatures: Array<{ id: string; title: string }>;
  updatedFeatures: Array<{ id: string; title: string }>;
  discoveredFeatures: Array<{ id: string; title: string }>;
  ignoredCount: number;
  codeIgnoredCount: number;
  remappedCount: number;
}> {
  logger.debug(
    `ki_feature_persist: persisting ${features.length} features for stream "${streamName}" run "${runId}"`
  );

  const rawFeatures: BaseFeature[] = [];
  for (const feature of features) {
    const candidate = {
      ...feature,
      stream_name: streamName,
      filter: tryParseFilter(feature.filter),
      ...(Array.isArray(feature.evidence)
        ? { evidence: feature.evidence.slice(0, MAX_EVIDENCE_ITEMS) }
        : {}),
    };
    const parsed = identifiedFeatureSchema.safeParse(candidate);
    if (!parsed.success || Object.keys(parsed.data.properties).length === 0) {
      continue;
    }
    rawFeatures.push(parsed.data);
  }

  const parsedIgnored: IgnoredFeature[] = [];
  for (const item of ignoredFeatures) {
    const parsed = ignoredFeatureSchema.safeParse(item);
    if (parsed.success) {
      parsedIgnored.push(parsed.data);
    }
  }

  const [{ hits: allFeatures }, { hits: excludedFeatures }] = await Promise.all([
    kiClient.getFeatures(streamName),
    kiClient.getExcludedFeatures(streamName),
  ]);

  const allKnownFeatures = allFeatures.filter((feature) => !isComputedFeature(feature));
  const discoveredFeatures = allKnownFeatures.filter((feature) => feature.run_id === runId);

  const { newFeatures, updatedFeatures, codeIgnoredCount, remappedCount } =
    reconcileInferredFeatures({
      rawFeatures,
      allKnownFeatures,
      discoveredFeatures,
      ignoredFeatures: parsedIgnored,
      excludedFeatures,
      runId,
      logger,
    });

  const allChanged = [...newFeatures, ...updatedFeatures];
  if (allChanged.length > 0) {
    const priorBySlug = new Map(
      allFeatures.map((feature) => [normalizeFeatureSlug(feature.id), feature])
    );
    await kiClient.bulk(
      streamName,
      allChanged.map((feature) => {
        const prior = priorBySlug.get(normalizeFeatureSlug(feature.id));
        const expiresAt = !prior || prior.expires_at ? kiClient.getDefaultExpiresAt() : undefined;
        return { index: { feature: { ...feature, expires_at: expiresAt } } };
      })
    );
  }

  const discoveredMap = new Map(
    discoveredFeatures.map((feature) => [feature.id, toFeatureSummary(feature)])
  );
  for (const feature of allChanged) {
    discoveredMap.set(feature.id, toFeatureSummary(feature));
  }

  return {
    newFeatures: newFeatures.map(toFeatureSummary),
    updatedFeatures: updatedFeatures.map(toFeatureSummary),
    discoveredFeatures: Array.from(discoveredMap.values()),
    ignoredCount: parsedIgnored.length,
    codeIgnoredCount,
    remappedCount,
  };
}
