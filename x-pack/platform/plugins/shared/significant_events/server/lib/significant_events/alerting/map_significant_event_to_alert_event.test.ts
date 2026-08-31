/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { ALERT_EPISODE_STATUS } from '@kbn/alerting-v2-schemas';
import { SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE } from '@kbn/significant-events-schema';
import {
  mapSignificantEventSeverityToAlertSeverity,
  mapSignificantEventStatusToAlertStatus,
  mapSignificantEventToCreateAlertEvent,
  significantEventAlertUrl,
} from './map_significant_event_to_alert_event';

describe('mapSignificantEventStatusToAlertStatus', () => {
  it.each([
    ['open', ALERT_EPISODE_STATUS.ACTIVE],
    ['closed', ALERT_EPISODE_STATUS.INACTIVE],
    ['dismissed', ALERT_EPISODE_STATUS.INACTIVE],
  ] as const)('maps %s → %s', (status, expected) => {
    expect(mapSignificantEventStatusToAlertStatus(status)).toBe(expected);
  });
});

describe('mapSignificantEventSeverityToAlertSeverity', () => {
  it.each([
    ['80-critical', 'critical'],
    ['60-high', 'high'],
    ['40-medium', 'medium'],
    ['20-low', 'low'],
  ] as const)('maps %s → %s', (severity, expected) => {
    expect(mapSignificantEventSeverityToAlertSeverity(severity)).toBe(expected);
  });
});

describe('mapSignificantEventToCreateAlertEvent', () => {
  const event = {
    '@timestamp': '2026-08-31T12:00:00.000Z',
    event_id: 'checkout-outage',
    event_uuid: 'uuid-1',
    title: 'Checkout — payment refused',
    status: 'open' as const,
    severity: '60-high' as const,
    stream_names: ['logs.checkout'],
  };

  it('uses source significant_events and fingerprint=event_id', () => {
    const payload = mapSignificantEventToCreateAlertEvent(event);

    expect(payload.source).toBe(SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE);
    expect(payload.fingerprint).toBe('checkout-outage');
    expect(payload.alert_status).toBe(ALERT_EPISODE_STATUS.ACTIVE);
    expect(payload.severity).toBe('high');
    expect(payload.data).toEqual(
      expect.objectContaining({
        event_id: 'checkout-outage',
        event_uuid: 'uuid-1',
        title: event.title,
        status: 'open',
        stream_names: ['logs.checkout'],
        rule_name: event.title,
        alert_url: significantEventAlertUrl('checkout-outage'),
      })
    );
  });

  it('maps closed and dismissed events to inactive', () => {
    expect(mapSignificantEventToCreateAlertEvent({ ...event, status: 'closed' }).alert_status).toBe(
      ALERT_EPISODE_STATUS.INACTIVE
    );
    expect(
      mapSignificantEventToCreateAlertEvent({ ...event, status: 'dismissed' }).alert_status
    ).toBe(ALERT_EPISODE_STATUS.INACTIVE);
  });
});
