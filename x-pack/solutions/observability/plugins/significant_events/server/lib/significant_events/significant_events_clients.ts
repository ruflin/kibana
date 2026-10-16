/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { AlertEventsClientApi } from '@kbn/alerting-v2-plugin/server';
import type { ElasticsearchClient } from '@kbn/core/server';
import { DetectionService } from './detections';
import type { DetectionClient } from './detections';
import { RuleEventsClient } from './events/rule_events_client';
import type { TriggerEmitter } from '../../workflows/triggers/emit';

export interface SignificantEventsServices {
  detection: DetectionService;
}

export interface SignificantEventsClients {
  getDetectionClient: () => Promise<DetectionClient>;
  /** Reads and writes Significant Events in `.rule-events`. */
  getEventSearchClient: () => Promise<RuleEventsClient>;
  /** Fire-and-forget workflow trigger emitter; undefined when workflows are unavailable. */
  emitTrigger: TriggerEmitter | undefined;
}

export function createSignificantEventsServices(): SignificantEventsServices {
  return {
    detection: new DetectionService(),
  };
}

export function createSignificantEventsClients({
  services,
  esClient,
  space,
  triggerEmitter,
  getAlertEventsClient,
}: {
  services: SignificantEventsServices;
  esClient: ElasticsearchClient;
  space: string;
  triggerEmitter?: TriggerEmitter;
  getAlertEventsClient: () => Promise<AlertEventsClientApi>;
}): SignificantEventsClients {
  const eventSearchClient = new RuleEventsClient({
    esClient,
    space,
    getAlertEventsClient,
    emitTrigger: triggerEmitter,
  });

  return {
    getDetectionClient: async () =>
      services.detection.getClient({ getAlertEventsClient, esClient, space }),
    getEventSearchClient: async () => eventSearchClient,
    emitTrigger: triggerEmitter,
  };
}
