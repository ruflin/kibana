/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreSetup, KibanaRequest, Logger } from '@kbn/core/server';
import { StorageIndexAdapter } from '@kbn/storage-adapter';
import type { StreamsPluginStartDependencies } from '../../../types';
import { FeatureClient } from './feature_client';
import type { StoredFeature } from './stored_feature';
import type { FeatureStorageSettings } from './storage_settings';
import { featureStorageSettings } from './storage_settings';
import {
  FEATURE_CONFIDENCE,
  FEATURE_DESCRIPTION,
  FEATURE_ID,
  FEATURE_LAST_SEEN,
  FEATURE_PROPERTIES,
  FEATURE_STATUS,
  FEATURE_SUBTYPE,
  FEATURE_TYPE,
  FEATURE_UUID,
  STREAM_NAME,
} from './fields';
import { storedFeatureSchema } from './stored_feature';

export class FeatureService {
  constructor(
    private readonly coreSetup: CoreSetup<StreamsPluginStartDependencies>,
    private readonly logger: Logger
  ) {}

  async getClientWithRequest({ request }: { request: KibanaRequest }): Promise<FeatureClient> {
    const [coreStart] = await this.coreSetup.getStartServices();

    const adapter = new StorageIndexAdapter<FeatureStorageSettings, StoredFeature>(
      coreStart.elasticsearch.client.asInternalUser,
      this.logger.get('features'),
      featureStorageSettings,
      {
        migrateSource: (source) => {
          let candidate = source as Record<string, unknown>;

          if (!(FEATURE_ID in candidate)) {
            candidate = {
              ...candidate,
              [FEATURE_ID]: candidate[FEATURE_UUID],
              [FEATURE_SUBTYPE]: candidate['feature.name'],
              [FEATURE_PROPERTIES]: candidate['feature.value'] ?? {},
            };
            delete candidate['feature.name'];
            delete candidate['feature.value'];
          }

          const result = storedFeatureSchema.safeParse(candidate);
          if (!result.success) {
            this.logger.debug(
              `Malformed feature document, applying defaults: ${result.error.message}`
            );
            const patched: Record<string, unknown> = {
              ...candidate,
              [FEATURE_ID]: candidate[FEATURE_ID] ?? 'unknown',
              [FEATURE_UUID]: candidate[FEATURE_UUID] ?? 'unknown',
              [FEATURE_TYPE]: candidate[FEATURE_TYPE] ?? 'unknown',
              [FEATURE_PROPERTIES]: candidate[FEATURE_PROPERTIES] ?? {},
              [FEATURE_CONFIDENCE]: candidate[FEATURE_CONFIDENCE] ?? 0,
              [FEATURE_STATUS]: candidate[FEATURE_STATUS] ?? 'active',
              [FEATURE_LAST_SEEN]: candidate[FEATURE_LAST_SEEN] ?? new Date().toISOString(),
              [FEATURE_DESCRIPTION]: candidate[FEATURE_DESCRIPTION] ?? '',
              [STREAM_NAME]: candidate[STREAM_NAME] ?? '',
            };
            return storedFeatureSchema.parse(patched);
          }

          return result.data;
        },
      }
    );

    return new FeatureClient({
      storageClient: adapter.getClient(),
    });
  }
}
