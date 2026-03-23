/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { v4 as uuid } from 'uuid';
import type { BaseFeature } from '@kbn/streams-schema';
import type { Logger } from '@kbn/core/server';
import type { FeatureClient } from '../../../lib/streams/feature/feature_client';
import type { StreamsClient } from '../../../lib/streams/client';

export type WriteFeatureKnowledgeIndicatorParams = BaseFeature;

export interface WriteFeatureKnowledgeIndicatorOutput {
  acknowledged: boolean;
  uuid: string;
}

export async function writeFeatureKnowledgeIndicatorHandler({
  streamsClient,
  featureClient,
  logger,
  params,
}: {
  streamsClient: StreamsClient;
  featureClient: FeatureClient;
  logger: Logger;
  params: WriteFeatureKnowledgeIndicatorParams;
}): Promise<WriteFeatureKnowledgeIndicatorOutput> {
  const { stream_name: streamName, ...featureFields } = params;

  await streamsClient.ensureStream(streamName);

  const featureUuid = uuid();
  const feature = {
    ...featureFields,
    stream_name: streamName,
    uuid: featureUuid,
    status: 'active' as const,
    last_seen: new Date().toISOString(),
  };

  await featureClient.bulk(streamName, [{ index: { feature } }]);

  logger.debug(`write_feature_knowledge_indicator: wrote feature ${featureUuid} to ${streamName}`);

  return { acknowledged: true, uuid: featureUuid };
}
