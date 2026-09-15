/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Logger } from '@kbn/logging';
import type { InferenceClient } from '@kbn/inference-common';
import {
  computeFeatureUuid,
  isDuplicateFeature,
  normalizeFeatureSlug,
  SIGNIFICANT_EVENTS_INFERENCE_PARENT_FEATURE_ID,
  SIGNIFICANT_EVENTS_KI_EXTRACTION_INFERENCE_FEATURE_ID,
  type Feature,
  type FeatureUpsert,
} from '@kbn/significant-events-schema';
import type { KnowledgeIndicatorClient } from '../../knowledge_indicators';
import { StatusError } from '../../errors/status_error';
import { deriveImpliedTopologyFeatures } from './derive_implied_topology_features';
import { generateTopologyFromKnowledgeIndicators } from './generate_topology_from_knowledge_indicators';

export interface RegenerateTopologyParams {
  requestedStreamNames?: string[];
  connectorId: string;
  kiClient: KnowledgeIndicatorClient;
  listStreamNames: () => Promise<string[]>;
  inferenceClient: InferenceClient;
  logger: Logger;
  signal: AbortSignal;
}

export interface RegenerateTopologyResult {
  streamNames: string[];
  createdCount: number;
  connectorId: string;
}

const isAlreadyPresent = (existing: readonly Feature[], incoming: FeatureUpsert): boolean =>
  existing.some(
    (feature) =>
      !feature.excluded &&
      (isDuplicateFeature(feature, incoming) ||
        (feature.stream_name === incoming.stream_name &&
          normalizeFeatureSlug(feature.id) === normalizeFeatureSlug(incoming.id)))
  );

const resolveScopedStreamNames = async ({
  requestedStreamNames,
  listStreamNames,
}: {
  requestedStreamNames: string[] | undefined;
  listStreamNames: () => Promise<string[]>;
}): Promise<string[]> => {
  const accessible = await listStreamNames();
  const accessibleSet = new Set(accessible);

  if (!requestedStreamNames?.length) {
    return accessible;
  }

  const scoped = requestedStreamNames.filter((name) => accessibleSet.has(name));
  if (scoped.length === 0) {
    throw new StatusError(
      'None of the selected streams are accessible for topology generation.',
      400
    );
  }
  return scoped;
};

export async function regenerateTopology({
  requestedStreamNames,
  connectorId,
  kiClient,
  listStreamNames,
  inferenceClient,
  logger,
  signal,
}: RegenerateTopologyParams): Promise<RegenerateTopologyResult> {
  const streamNames = await resolveScopedStreamNames({
    requestedStreamNames,
    listStreamNames,
  });

  if (streamNames.length === 0) {
    throw new StatusError('No accessible streams were found for topology generation.', 400);
  }

  const { hits: features } = await kiClient.getFeatures(streamNames);
  if (features.length === 0) {
    throw new StatusError(
      'No knowledge indicators were found for the selected streams. Generate knowledge indicators first, then generate topology.',
      400
    );
  }

  const implied = deriveImpliedTopologyFeatures(features);
  const boundInferenceClient = inferenceClient.bindTo({
    connectorId,
    metadata: {
      connectorTelemetry: {
        pluginId: SIGNIFICANT_EVENTS_KI_EXTRACTION_INFERENCE_FEATURE_ID,
        aggregateBy: SIGNIFICANT_EVENTS_INFERENCE_PARENT_FEATURE_ID,
      },
    },
  });

  const generated = await generateTopologyFromKnowledgeIndicators({
    features,
    inferenceClient: boundInferenceClient,
    logger,
    signal,
  });

  const runId = uuidv4();
  const updatedAt = new Date().toISOString();
  const expiresAt = kiClient.getDefaultExpiresAt();
  const known = [...features];
  const toWrite: FeatureUpsert[] = [];

  for (const incoming of [...implied, ...generated]) {
    if (isAlreadyPresent(known, incoming)) {
      continue;
    }
    const upsert: FeatureUpsert = {
      ...incoming,
      run_id: runId,
      updated_at: updatedAt,
      expires_at: expiresAt,
    };
    toWrite.push(upsert);
    known.push({ ...upsert, uuid: computeFeatureUuid(upsert) });
  }

  const byStream = new Map<string, FeatureUpsert[]>();
  for (const feature of toWrite) {
    const bucket = byStream.get(feature.stream_name);
    if (bucket) {
      bucket.push(feature);
    } else {
      byStream.set(feature.stream_name, [feature]);
    }
  }

  for (const [streamName, streamFeatures] of byStream) {
    await kiClient.bulk(
      streamName,
      streamFeatures.map((feature) => ({ index: { feature } }))
    );
  }

  logger.debug(
    `Generated ${toWrite.length} topology knowledge indicators across ${byStream.size} stream(s)`
  );

  return {
    streamNames,
    createdCount: toWrite.length,
    connectorId,
  };
}
