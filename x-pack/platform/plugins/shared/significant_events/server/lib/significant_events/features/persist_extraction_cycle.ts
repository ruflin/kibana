/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EXTRACTION_CYCLE_FEATURE_TYPE, type FeatureUpsert } from '@kbn/significant-events-schema';
import type { KnowledgeIndicatorClient } from '../../knowledge_indicators';

/**
 * Keep-alive-immune recency marker. Always expiring so keep-alive restamps of
 * durable inferred features cannot disable re-identification forever.
 */
export function createExtractionCycleHeartbeat({
  streamName,
  runId,
  expiresAt,
}: {
  streamName: string;
  runId: string;
  expiresAt: string;
}): FeatureUpsert {
  return {
    id: EXTRACTION_CYCLE_FEATURE_TYPE,
    stream_name: streamName,
    type: EXTRACTION_CYCLE_FEATURE_TYPE,
    description:
      'Keep-alive-immune recency marker for the last successful KI identification cycle.',
    properties: {},
    confidence: 100,
    run_id: runId,
    expires_at: expiresAt,
  };
}

export async function persistExtractionCycleHeartbeat({
  kiClient,
  streamName,
  runId,
}: {
  kiClient: KnowledgeIndicatorClient;
  streamName: string;
  runId: string;
}): Promise<void> {
  await kiClient.bulk(streamName, [
    {
      index: {
        feature: createExtractionCycleHeartbeat({
          streamName,
          runId,
          expiresAt: kiClient.getDefaultExpiresAt(),
        }),
      },
    },
  ]);
}
