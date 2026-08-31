/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { loggingSystemMock } from '@kbn/core-logging-server-mocks';
import { SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE } from '@kbn/significant-events-schema';
import type { SignificantEvent } from '@kbn/significant-events-schema';
import {
  createPromoteSignificantEventToEpisode,
  type AlertEventsCreateClient,
} from './promote_event_to_episode';

const event: SignificantEvent = {
  '@timestamp': '2026-08-31T12:00:00.000Z',
  event_id: 'checkout-outage',
  event_uuid: 'uuid-1',
  status: 'open',
  title: 'Checkout — payment refused',
  summary: 'Payment path refused',
  severity: '60-high',
  confidence: 0.8,
  stream_names: ['logs.checkout'],
};

const createLogger = () => loggingSystemMock.createLogger();

describe('createPromoteSignificantEventToEpisode', () => {
  it('creates an Alerting v2 episode with source significant_events and fingerprint=event_id', async () => {
    const createAlertEvent = jest.fn().mockResolvedValue({
      group_hash: 'hash-1',
      episode_id: 'ep-1',
    });
    const promote = createPromoteSignificantEventToEpisode({
      logger: createLogger(),
      isAlertingV2Enabled: async () => true,
      getAlertEventsClient: async () => ({ createAlertEvent }) satisfies AlertEventsCreateClient,
    });

    const provenance = await promote(event);

    expect(createAlertEvent).toHaveBeenCalledTimes(1);
    expect(createAlertEvent.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        source: SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE,
        fingerprint: 'checkout-outage',
        alert_status: 'active',
      })
    );
    expect(provenance).toEqual(
      expect.objectContaining({
        source: SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE,
        group_hash: 'hash-1',
        episode_id: 'ep-1',
        last_alert_status: 'active',
      })
    );
  });

  it('skips createAlertEvent when Alerting v2 is disabled', async () => {
    const createAlertEvent = jest.fn();
    const promote = createPromoteSignificantEventToEpisode({
      logger: createLogger(),
      isAlertingV2Enabled: async () => false,
      getAlertEventsClient: async () => ({ createAlertEvent }),
    });

    await expect(promote(event)).resolves.toBeUndefined();
    expect(createAlertEvent).not.toHaveBeenCalled();
  });

  it('swallows createAlertEvent failures so the SIG write is not rolled back', async () => {
    const logger = createLogger();
    const promote = createPromoteSignificantEventToEpisode({
      logger,
      isAlertingV2Enabled: async () => true,
      getAlertEventsClient: async () => ({
        createAlertEvent: jest.fn().mockRejectedValue(new Error('ingest failed')),
      }),
    });

    await expect(promote(event)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to promote event_id=checkout-outage')
    );
  });
});
