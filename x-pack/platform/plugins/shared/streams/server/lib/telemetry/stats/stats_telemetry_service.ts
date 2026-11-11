/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreSetup, Logger } from '@kbn/core/server';
import type { UsageCollectionSetup } from '@kbn/usage-collection-plugin/server';
import type { Streams } from '@kbn/streams-schema';
import type { StreamsPluginStartDependencies } from '../../../types';
import { registerStreamsUsageCollector } from './streams_usage_collector';
import { createStreamsStorageClient } from '../../streams/storage/streams_storage_client';
import { readStreamDefinitions } from '../../streams/storage/read_stream_definitions';
import type { StreamsUsageReader } from './streams_usage_collector';

/**
 * Service for collecting Streams usage statistics for telemetry
 */
export class StatsTelemetryService {
  constructor() {}

  public setup(
    core: CoreSetup<StreamsPluginStartDependencies>,
    logger: Logger,
    usageCollection?: UsageCollectionSetup
  ) {
    if (!usageCollection) {
      logger.debug(
        '[Streams Stats Telemetry Service] Usage collection not available, skipping setup'
      );
      return;
    }

    logger.debug('[Streams Stats Telemetry Service] Setting up streams usage collector');

    // Provide a reader factory so future methods can share the same storage client
    registerStreamsUsageCollector(usageCollection, logger, () => this.getUsageReader(core, logger));
  }

  private async getUsageReader(
    core: CoreSetup<StreamsPluginStartDependencies>,
    logger: Logger
  ): Promise<StreamsUsageReader> {
    const [coreStart] = await core.getStartServices();
    const esClient = coreStart.elasticsearch.client.asInternalUser;
    const storageClient = createStreamsStorageClient(esClient, logger);

    return {
      async readAllManagedStreams(): Promise<Streams.all.Definition[]> {
        const definitions = await readStreamDefinitions(storageClient);
        return definitions.filter((definition) => !('group' in definition)); // Filter out old Group streams
      },
    };
  }
}
