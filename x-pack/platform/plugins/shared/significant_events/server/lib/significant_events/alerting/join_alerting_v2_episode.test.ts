/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE } from '@kbn/significant-events-schema';
import type { SignificantEvent } from '@kbn/significant-events-schema';
import { METRIC_SERIES_RULE_TAG } from '../rules/metric_series_contract';
import { STREAMS_RULE_STREAM_TAG_PREFIX } from '../../knowledge_indicators/knowledge_indicator_client/rules/rules_management_client';
import {
  ALERTING_V2_EPISODE_JOIN_WINDOW_MS,
  resolveAlertingV2EpisodeJoin,
  type AlertingV2EpisodeJoinCandidate,
} from './join_alerting_v2_episode';

const NOW = new Date('2026-08-31T12:00:00.000Z');

const openEvent = (overrides: Partial<SignificantEvent> = {}): SignificantEvent => ({
  '@timestamp': '2026-08-31T11:00:00.000Z',
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
  causal_features: [
    {
      feature_id: 'checkout-api',
      name: 'checkout-api',
      stream_name: 'logs.checkout',
    },
  ],
  ...overrides,
});

const candidate = (
  overrides: Partial<AlertingV2EpisodeJoinCandidate> = {}
): AlertingV2EpisodeJoinCandidate => ({
  spaceId: 'default',
  source: 'datadog',
  kind: 'alert',
  episodeId: 'ep-user-1',
  groupHash: 'gh-user-1',
  ruleId: 'user-rule-1',
  ruleName: 'Checkout error rate',
  episodeStatus: 'active',
  firstTimestamp: '2026-08-31T11:30:00.000Z',
  lastTimestamp: '2026-08-31T11:45:00.000Z',
  ...overrides,
});

describe('resolveAlertingV2EpisodeJoin', () => {
  it('joins onto the unique open event that already lists the candidate rule id', () => {
    const event = openEvent({
      signals: [
        ...(openEvent().signals ?? []),
        {
          type: 'alerting_v2_episode',
          stream_name: 'logs.checkout',
          description: 'Prior user alert.',
          verdict: 'confirms',
          metadata: {
            episode_id: 'ep-prior',
            group_hash: 'gh-prior',
            rule_id: 'user-rule-1',
            source: 'datadog',
            episode_status: 'active',
          },
        },
      ],
    });

    const result = resolveAlertingV2EpisodeJoin({
      candidate: candidate(),
      openEvents: [event],
      spaceId: 'default',
      now: NOW,
    });

    expect(result.action).toBe('join');
    if (result.action === 'join') {
      expect(result.eventId).toBe('checkout-outage');
      expect(result.signal.type).toBe('alerting_v2_episode');
      expect(result.signal.metadata.episode_id).toBe('ep-user-1');
      expect(result.signal.metadata.rule_id).toBe('user-rule-1');
    }
  });

  it('joins via a shared stream name from a sigevents:stream tag', () => {
    const result = resolveAlertingV2EpisodeJoin({
      candidate: candidate({
        ruleId: 'unrelated-rule',
        ruleTags: [`${STREAMS_RULE_STREAM_TAG_PREFIX}logs.checkout`],
      }),
      openEvents: [openEvent()],
      spaceId: 'default',
      now: NOW,
    });

    expect(result.action).toBe('join');
    if (result.action === 'join') {
      expect(result.signal.stream_name).toBe('logs.checkout');
    }
  });

  it('joins via a matching causal feature / service name', () => {
    const result = resolveAlertingV2EpisodeJoin({
      candidate: candidate({
        ruleId: 'unrelated-rule',
        serviceNames: ['checkout-api'],
      }),
      openEvents: [openEvent()],
      spaceId: 'default',
      now: NOW,
    });

    expect(result.action).toBe('join');
  });

  it('does not mint a new SIG event when nothing open matches (join-only)', () => {
    const result = resolveAlertingV2EpisodeJoin({
      candidate: candidate({ ruleId: 'orphan-rule', streamNames: ['logs.other'] }),
      openEvents: [openEvent()],
      spaceId: 'default',
      now: NOW,
    });

    expect(result).toEqual({ action: 'skip', reason: 'no_identity_hit' });
  });

  it('skips when zero open events exist', () => {
    const result = resolveAlertingV2EpisodeJoin({
      candidate: candidate(),
      openEvents: [],
      spaceId: 'default',
      now: NOW,
    });

    expect(result).toEqual({ action: 'skip', reason: 'no_open_event' });
  });

  it('skips when more than one open event matches', () => {
    const result = resolveAlertingV2EpisodeJoin({
      candidate: candidate({
        ruleId: 'unrelated-rule',
        ruleTags: [`${STREAMS_RULE_STREAM_TAG_PREFIX}logs.checkout`],
      }),
      openEvents: [
        openEvent({ event_id: 'event-a' }),
        openEvent({ event_id: 'event-b', event_uuid: 'uuid-2' }),
      ],
      spaceId: 'default',
      now: NOW,
    });

    expect(result).toEqual({ action: 'skip', reason: 'ambiguous_open_events' });
  });

  it('does not join across Kibana spaces', () => {
    const result = resolveAlertingV2EpisodeJoin({
      candidate: candidate({ spaceId: 'other' }),
      openEvents: [openEvent()],
      spaceId: 'default',
      now: NOW,
    });

    expect(result).toEqual({ action: 'skip', reason: 'space_mismatch' });
  });

  it('does not re-ingest a Direction A promotion', () => {
    const result = resolveAlertingV2EpisodeJoin({
      candidate: candidate({ source: SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE }),
      openEvents: [openEvent()],
      spaceId: 'default',
      now: NOW,
    });

    expect(result).toEqual({ action: 'skip', reason: 'source_significant_events' });
  });

  it('does not ingest SIG-owned match-count rules', () => {
    const result = resolveAlertingV2EpisodeJoin({
      candidate: candidate({
        ruleTags: [METRIC_SERIES_RULE_TAG],
      }),
      openEvents: [openEvent()],
      spaceId: 'default',
      now: NOW,
    });

    expect(result).toEqual({ action: 'skip', reason: 'sigevents_match_count_rule' });
  });

  it('skips episodes outside the join window', () => {
    const stale = new Date(NOW.getTime() - ALERTING_V2_EPISODE_JOIN_WINDOW_MS - 60_000);
    const result = resolveAlertingV2EpisodeJoin({
      candidate: candidate({
        firstTimestamp: stale.toISOString(),
        lastTimestamp: stale.toISOString(),
        ruleTags: [`${STREAMS_RULE_STREAM_TAG_PREFIX}logs.checkout`],
      }),
      openEvents: [openEvent()],
      spaceId: 'default',
      now: NOW,
    });

    expect(result).toEqual({ action: 'skip', reason: 'no_temporal_overlap' });
  });
});
