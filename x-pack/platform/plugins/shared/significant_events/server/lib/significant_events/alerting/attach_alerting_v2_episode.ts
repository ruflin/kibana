/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EventClient } from '../events';
import { eventsWriteBulkHandler } from '../../../agent_builder/tools/event_write/handler';
import type { PromoteSignificantEventToEpisode } from './promote_event_to_episode';
import {
  resolveAlertingV2EpisodeJoin,
  type AlertingV2EpisodeJoinCandidate,
  type AlertingV2EpisodeJoinResult,
} from './join_alerting_v2_episode';

export type AttachAlertingV2EpisodeResult =
  | {
      attached: true;
      event_id: string;
      event_uuid?: string;
      written: boolean;
    }
  | {
      attached: false;
      reason: Extract<AlertingV2EpisodeJoinResult, { action: 'skip' }>['reason'];
    };

/**
 * Direction B Stage 1 call site: join-only continuation onto an existing open
 * significant event. Does not create a new event when the candidate is an orphan.
 *
 * A workflow subscriber (or HTTP handler) should pass the current-space open
 * events from `eventClient.findLatestActive` plus the incoming episode. Wiring
 * that subscriber to `alerting.episodeActivated` is left as a follow-up until
 * the ingest contract with RNA is confirmed.
 */
export const attachAlertingV2EpisodeToOpenSignificantEvent = async ({
  eventClient,
  spaceId,
  candidate,
  openEvents,
  now,
  promoteToAlertingV2,
}: {
  eventClient: EventClient;
  spaceId: string;
  candidate: AlertingV2EpisodeJoinCandidate;
  openEvents: Parameters<typeof resolveAlertingV2EpisodeJoin>[0]['openEvents'];
  now?: Date;
  promoteToAlertingV2?: PromoteSignificantEventToEpisode;
}): Promise<AttachAlertingV2EpisodeResult> => {
  const join = resolveAlertingV2EpisodeJoin({ candidate, openEvents, spaceId, now });
  if (join.action === 'skip') {
    return { attached: false, reason: join.reason };
  }

  const target = openEvents.find((event) => event.event_id === join.eventId);
  if (!target) {
    return { attached: false, reason: 'no_open_event' };
  }

  const [result] = await eventsWriteBulkHandler({
    eventClient,
    inputs: [
      {
        event_id: target.event_id,
        status: target.status,
        stream_names: target.stream_names,
        title: target.title,
        symptom_hypothesis: target.symptom_hypothesis,
        summary: target.summary,
        severity: target.severity,
        confidence: target.confidence,
        assessment_note: target.assessment_note,
        signals: [join.signal],
        causal_features: target.causal_features,
        blast_radius: target.blast_radius,
      },
    ],
    promoteToAlertingV2,
  });

  if (result === undefined || (!result.written && !('skipped' in result))) {
    return { attached: false, reason: 'no_open_event' };
  }

  return {
    attached: true,
    event_id: result.event_id,
    event_uuid: 'event_uuid' in result ? result.event_uuid : undefined,
    written: result.written,
  };
};
