/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ALERT_EPISODE_STATUS, type CreateAlertEventData } from '@kbn/alerting-v2-schemas';
import {
  SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE,
  type AlertingV2EpisodeStatus,
  type AlertingV2EventSeverity,
  type Severity,
  type SignificantEvent,
  type SignificantEventStatus,
} from '@kbn/significant-events-schema';
import { SIGNIFICANT_EVENTS_APP_ROUTE } from '../../../../common/constants';

const STATUS_TO_ALERT: Record<SignificantEventStatus, AlertingV2EpisodeStatus> = {
  open: ALERT_EPISODE_STATUS.ACTIVE,
  closed: ALERT_EPISODE_STATUS.INACTIVE,
  dismissed: ALERT_EPISODE_STATUS.INACTIVE,
};

const SEVERITY_TO_ALERT: Record<Severity, AlertingV2EventSeverity> = {
  '80-critical': 'critical',
  '60-high': 'high',
  '40-medium': 'medium',
  '20-low': 'low',
};

/** Map a Significant Event status onto the Alerting v2 episode lifecycle. */
export const mapSignificantEventStatusToAlertStatus = (
  status: SignificantEventStatus
): AlertingV2EpisodeStatus => STATUS_TO_ALERT[status];

/** Map SIG sortable severity onto the Alerting v2 event severity vocabulary. */
export const mapSignificantEventSeverityToAlertSeverity = (
  severity: Severity
): AlertingV2EventSeverity => SEVERITY_TO_ALERT[severity];

/** Deep link into the Significant Events flyout for a stable `event_id`. */
export const significantEventAlertUrl = (eventId: string): string =>
  `${SIGNIFICANT_EVENTS_APP_ROUTE}/significant_events?openEvent=${encodeURIComponent(eventId)}`;

type SignificantEventAlertPayload = Pick<
  SignificantEvent,
  'event_id' | 'event_uuid' | 'title' | 'status' | 'severity' | 'stream_names' | '@timestamp'
>;

/**
 * Builds the Alerting v2 `createAlertEvent` payload for Direction A.
 * Fingerprint is the SIG `event_id` so continuations reuse the same series.
 */
export const mapSignificantEventToCreateAlertEvent = (
  event: SignificantEventAlertPayload
): CreateAlertEventData => ({
  source: SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE,
  fingerprint: event.event_id,
  alert_status: mapSignificantEventStatusToAlertStatus(event.status),
  severity: mapSignificantEventSeverityToAlertSeverity(event.severity),
  timestamp: event['@timestamp'],
  data: {
    event_id: event.event_id,
    event_uuid: event.event_uuid,
    title: event.title,
    status: event.status,
    stream_names: event.stream_names,
    rule_name: event.title,
    alert_url: significantEventAlertUrl(event.event_id),
  },
});
