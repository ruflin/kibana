/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE } from '@kbn/significant-events-schema';
import type { SignificantEvent } from '@kbn/significant-events-schema';
import type { EventClient } from '../events';
import { attachAlertingV2EpisodeToOpenSignificantEvent } from './attach_alerting_v2_episode';
import type { AlertingV2EpisodeJoinCandidate } from './join_alerting_v2_episode';

const TS_EARLIER = '2026-08-31T11:00:00.000Z';
const NOW = new Date('2026-08-31T12:00:00.000Z');

const successfulBulkCreate = async (documents: object[]) => ({
  errors: false,
  items: documents.map(() => ({ create: { status: 201, result: 'created' } })),
});

const openEvent = (): SignificantEvent => ({
  '@timestamp': TS_EARLIER,
  event_id: 'checkout-outage',
  event_uuid: 'uuid-1',
  status: 'open',
  title: 'Checkout — payment refused',
  summary: 'Payment path refused',
  severity: '60-high',
  confidence: 0.8,
  stream_names: ['logs.checkout'],
  signals: [
    {
      type: 'detection',
      stream_name: 'logs.checkout',
      description: 'Found: payment refused. Impact: checkout blocked.',
      verdict: 'confirms',
      evidence: { esql_query: 'FROM logs.checkout | LIMIT 1', result: 'found' },
      metadata: {
        detection_id: 'det-1',
        rule_uuid: 'ki-rule-1',
        change_point_type: 'spike',
        p_value: 0.01,
      },
    },
  ],
});

const candidate = (
  overrides: Partial<AlertingV2EpisodeJoinCandidate> = {}
): AlertingV2EpisodeJoinCandidate => ({
  spaceId: 'default',
  source: 'datadog',
  kind: 'alert',
  episodeId: 'ep-user-1',
  groupHash: 'gh-user-1',
  ruleId: 'unrelated-rule',
  ruleName: 'Checkout error rate',
  ruleTags: ['sigevents:stream:logs.checkout'],
  episodeStatus: 'active',
  firstTimestamp: '2026-08-31T11:30:00.000Z',
  lastTimestamp: '2026-08-31T11:45:00.000Z',
  ...overrides,
});

const makeEventClient = (): jest.Mocked<EventClient> =>
  ({
    findLatestActive: jest.fn().mockResolvedValue({ hits: [] }),
    findLatestByEventIds: jest.fn().mockResolvedValue(new Map()),
    findByEventId: jest.fn().mockResolvedValue({ hits: [openEvent()] }),
    bulkCreate: jest.fn().mockImplementation(successfulBulkCreate),
    emitTrigger: jest.fn(),
  } as jest.Mocked<EventClient>);

describe('attachAlertingV2EpisodeToOpenSignificantEvent', () => {
  it('writes a join-only continuation with an alerting_v2_episode signal', async () => {
    const eventClient = makeEventClient();

    const result = await attachAlertingV2EpisodeToOpenSignificantEvent({
      eventClient,
      spaceId: 'default',
      candidate: candidate(),
      openEvents: [openEvent()],
      now: NOW,
    });

    expect(result).toEqual(
      expect.objectContaining({ attached: true, event_id: 'checkout-outage', written: true })
    );
    const writtenDoc = eventClient.bulkCreate.mock.calls[0][0][0] as Partial<SignificantEvent>;
    expect(writtenDoc.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'alerting_v2_episode',
          metadata: expect.objectContaining({ episode_id: 'ep-user-1', source: 'datadog' }),
        }),
      ])
    );
  });

  it('does not write when the candidate is a Direction A promotion (loop filter)', async () => {
    const eventClient = makeEventClient();

    const result = await attachAlertingV2EpisodeToOpenSignificantEvent({
      eventClient,
      spaceId: 'default',
      candidate: candidate({ source: SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE }),
      openEvents: [openEvent()],
      now: NOW,
    });

    expect(result).toEqual({ attached: false, reason: 'source_significant_events' });
    expect(eventClient.bulkCreate).not.toHaveBeenCalled();
  });

  it('does not mint a new SIG event for an orphan user alert', async () => {
    const eventClient = makeEventClient();

    const result = await attachAlertingV2EpisodeToOpenSignificantEvent({
      eventClient,
      spaceId: 'default',
      candidate: candidate({
        ruleTags: [],
        streamNames: ['logs.other'],
        ruleId: 'orphan-rule',
      }),
      openEvents: [openEvent()],
      now: NOW,
    });

    expect(result).toEqual({ attached: false, reason: 'no_identity_hit' });
    expect(eventClient.bulkCreate).not.toHaveBeenCalled();
  });
});
