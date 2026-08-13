/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { compact } from 'lodash';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import {
  DEFAULT_SIGNIFICANT_EVENTS_TUNING_CONFIG,
  isComputedFeature,
  isFeatureWithFilter,
  type SignificantEventsTuningConfig,
} from '@kbn/significant-events-schema';
import { getStreamSamplingSource, type Streams } from '@kbn/streams-schema';
import { formatRawDocument } from '@kbn/streams-ai';
import type { KnowledgeIndicatorClient } from '../../../lib/knowledge_indicators';
import { fetchSampleDocuments } from '../../../lib/significant_events/features/fetch_sample_documents';
import { MS_PER_DAY } from '../../../lib/significant_events/features';

export interface SampleStreamDocumentsParams {
  streamName: string;
  runId?: string;
  start?: number;
  end?: number;
  iteration?: number;
  sampleSize?: number;
  entityFilteredRatio?: number;
  diverseRatio?: number;
  maxEntityFilters?: number;
  samplingTimeoutMs?: number;
}

export async function sampleStreamDocumentsToolHandler({
  kiClient,
  samplingEsClient,
  stream,
  tuningConfig,
  params,
  logger,
}: {
  kiClient: KnowledgeIndicatorClient;
  samplingEsClient: ElasticsearchClient;
  stream: Streams.all.Definition;
  tuningConfig: SignificantEventsTuningConfig;
  params: SampleStreamDocumentsParams;
  logger: Logger;
}): Promise<{
  hasDocuments: boolean;
  docsCount: number;
  documents: Array<{ _id?: string; fields: Record<string, unknown> }>;
  totalFilters: number;
  filtersCapped: boolean;
  hasFilteredDocuments: boolean;
}> {
  const now = Date.now();
  const {
    streamName,
    runId,
    start = now - MS_PER_DAY,
    end = now,
    iteration = 1,
    sampleSize = tuningConfig.sample_size,
    entityFilteredRatio = tuningConfig.entity_filtered_ratio,
    diverseRatio = tuningConfig.diverse_ratio,
    maxEntityFilters = tuningConfig.max_entity_filters,
    samplingTimeoutMs = tuningConfig.sampling_timeout_ms,
  } = params;

  logger.debug(
    `ki_sample_documents: sampling stream "${streamName}" iteration=${iteration} size=${sampleSize}`
  );

  const { hits: allFeatures } = await kiClient.getFeatures(streamName);
  const samplingFeatures = allFeatures
    .filter((feature) => !isComputedFeature(feature))
    .filter((feature) => runId === undefined || feature.run_id === runId)
    .filter(isFeatureWithFilter);

  const batchResult = await fetchSampleDocuments({
    esClient: samplingEsClient,
    index: getStreamSamplingSource(stream),
    start,
    end,
    features: samplingFeatures,
    logger,
    size: sampleSize,
    entityFilteredRatio,
    diverseRatio,
    maxEntityFilters,
    iteration,
    samplingTimeoutMs,
  });

  const documents = compact(
    batchResult.documents.map((hit) =>
      formatRawDocument({
        hit,
        shouldNotTruncate(key: string) {
          return key.includes('tags');
        },
      })
    )
  );

  return {
    hasDocuments: documents.length > 0,
    docsCount: documents.length,
    documents,
    totalFilters: batchResult.totalFilters,
    filtersCapped: batchResult.filtersCapped,
    hasFilteredDocuments: batchResult.hasFilteredDocuments,
  };
}

export const defaultSampleTuning = DEFAULT_SIGNIFICANT_EVENTS_TUNING_CONFIG;
