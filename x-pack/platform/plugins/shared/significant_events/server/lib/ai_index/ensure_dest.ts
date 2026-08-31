/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { SIGNIFICANT_EVENTS_AI_INDEX_DEST } from '../../../common/constants';

/**
 * Creates the Context Engine dest index when it does not already exist.
 * Cluster `ai-index@mappings` templates supply the KI field mappings.
 * Failures are logged and swallowed so plugin start is not blocked.
 */
export async function ensureSignificantEventsAiIndexDest({
  esClient,
  logger,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
}): Promise<void> {
  const index = SIGNIFICANT_EVENTS_AI_INDEX_DEST;
  try {
    const exists = await esClient.indices.exists({ index });
    if (exists) {
      return;
    }
    await esClient.indices.create({ index });
    logger.info(`Created AI index dest '${index}'`);
  } catch (error) {
    logger.warn(
      `Failed to ensure AI index dest '${index}': ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
