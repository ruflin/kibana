/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CreateAlertEventData } from '@kbn/alerting-v2-schemas';
import type { Logger } from '@kbn/logging';
import type {
  SignificantEvent,
  SignificantEventAlertingV2Provenance,
} from '@kbn/significant-events-schema';
import { SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE } from '@kbn/significant-events-schema';
import {
  mapSignificantEventStatusToAlertStatus,
  mapSignificantEventToCreateAlertEvent,
} from './map_significant_event_to_alert_event';

export interface AlertEventsCreateClient {
  createAlertEvent(
    event: CreateAlertEventData,
    options?: { abortSignal?: AbortSignal }
  ): Promise<{ group_hash: string; episode_id: string }>;
}

export type PromoteSignificantEventToEpisode = (
  event: SignificantEvent
) => Promise<SignificantEventAlertingV2Provenance | undefined>;

/**
 * Best-effort Direction A promoter. Never throws: a Significant Event write must
 * not roll back because Alerting v2 ingest failed or is disabled.
 */
export const createPromoteSignificantEventToEpisode = ({
  logger,
  isAlertingV2Enabled,
  getAlertEventsClient,
}: {
  logger: Logger;
  isAlertingV2Enabled: () => Promise<boolean>;
  getAlertEventsClient: () => Promise<AlertEventsCreateClient>;
}): PromoteSignificantEventToEpisode => {
  return async (event) => {
    try {
      const enabled = await isAlertingV2Enabled();
      if (!enabled) {
        return undefined;
      }

      const client = await getAlertEventsClient();
      const result = await client.createAlertEvent(mapSignificantEventToCreateAlertEvent(event));

      return {
        source: SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE,
        group_hash: result.group_hash,
        episode_id: result.episode_id,
        last_alert_status: mapSignificantEventStatusToAlertStatus(event.status),
        last_synced_at: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(
        `significantEvents: failed to promote event_id=${event.event_id} to Alerting v2: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return undefined;
    }
  };
};
