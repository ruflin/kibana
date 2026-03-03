/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreSetup, KibanaRequest } from '@kbn/core/server';
import type { Logger } from '@kbn/logging';
import type { DiscoveryClient } from '../../lib/discoveries/discovery_client';
import type { StreamsClient } from '../../lib/streams/client';
import type { StreamsPluginStartDependencies } from '../../types';

export interface StreamsToolsDependencies {
  core: CoreSetup<StreamsPluginStartDependencies>;
  logger: Logger;
  getDiscoveryClient: (request: KibanaRequest) => Promise<DiscoveryClient>;
  getStreamsClient: (request: KibanaRequest) => Promise<StreamsClient>;
  getEsClient: (request: KibanaRequest) => Promise<{
    asCurrentUser: import('@elastic/elasticsearch').Client;
  }>;
}
