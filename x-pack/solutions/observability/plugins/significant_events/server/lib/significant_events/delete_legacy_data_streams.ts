/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';

/** Retired Significant Events history stream; events now live in `.rule-events`. */
export const LEGACY_EVENTS_DATA_STREAM = '.significant_events-events';

/** Retired detections stream; detections and their markers are now signals in `.rule-events`. */
export const LEGACY_DETECTIONS_DATA_STREAM = '.significant_events-detections';

export const LEGACY_DATA_STREAMS = [LEGACY_EVENTS_DATA_STREAM, LEGACY_DETECTIONS_DATA_STREAM];

const isNotFound = (error: unknown): boolean =>
  (error as { meta?: { statusCode?: number } })?.meta?.statusCode === 404;

/**
 * Deletes the retired data streams and their templates without backfilling their history into
 * `.rule-events`.
 * TODO: Remove this once envs are up to date (https://github.com/elastic/kibana/issues/294271).
 */
export const deleteLegacyDataStreams = async ({
  esClient,
  logger,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
}): Promise<void> => {
  const deleteIgnoringNotFound = async (
    label: string,
    name: string,
    run: () => Promise<unknown>
  ): Promise<void> => {
    try {
      await run();
      logger.info(`Deleted retired ${label} ${name}`);
    } catch (error) {
      if (isNotFound(error)) {
        return;
      }
      logger.warn(
        `Failed to delete retired ${label} ${name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  for (const name of LEGACY_DATA_STREAMS) {
    await deleteIgnoringNotFound('data stream', name, () =>
      esClient.indices.deleteDataStream({ name })
    );
    await deleteIgnoringNotFound('index template', name, () =>
      esClient.indices.deleteIndexTemplate({ name })
    );
  }
};
