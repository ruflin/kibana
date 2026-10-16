/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { AlertEventsClientApi } from '@kbn/alerting-v2-plugin/server';
import { DetectionClient } from './detection_client';

export class DetectionService {
  getClient({
    getAlertEventsClient,
    esClient,
    space,
  }: {
    getAlertEventsClient: () => Promise<Pick<AlertEventsClientApi, 'createSignalEvents'>>;
    esClient: ElasticsearchClient;
    space: string;
  }): DetectionClient {
    return new DetectionClient({
      getAlertEventsClient,
      esClient,
      space,
    });
  }
}
