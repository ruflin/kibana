/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE } from '@kbn/significant-events-schema';
import { METRIC_SERIES_RULE_TAG } from '../rules/metric_series_contract';
import { STREAMS_RULE_STREAM_TAG_PREFIX } from '../../knowledge_indicators/knowledge_indicator_client/rules/rules_management_client';
import { shouldIngestAlertingV2Episode } from './should_ingest_alerting_v2_episode';

describe('shouldIngestAlertingV2Episode', () => {
  it('drops Direction A promotions (source=significant_events)', () => {
    expect(
      shouldIngestAlertingV2Episode({
        source: SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE,
        kind: 'alert',
      })
    ).toEqual({ ingest: false, reason: 'source_significant_events' });
  });

  it('drops kind: signal series (no episode lifecycle)', () => {
    expect(
      shouldIngestAlertingV2Episode({
        source: 'datadog',
        kind: 'signal',
      })
    ).toEqual({ ingest: false, reason: 'kind_signal' });
  });

  it('drops SIG-owned match-count rules', () => {
    expect(
      shouldIngestAlertingV2Episode({
        source: 'elastic-rules',
        kind: 'alert',
        ruleTags: [`${STREAMS_RULE_STREAM_TAG_PREFIX}logs.checkout`, METRIC_SERIES_RULE_TAG],
      })
    ).toEqual({ ingest: false, reason: 'sigevents_match_count_rule' });
  });

  it('allows a user kind:alert episode, including stream tags used as join keys', () => {
    expect(
      shouldIngestAlertingV2Episode({
        source: 'datadog',
        kind: 'alert',
        ruleTags: [`${STREAMS_RULE_STREAM_TAG_PREFIX}logs.checkout`],
      })
    ).toEqual({ ingest: true });
  });

  it('allows an external episode with no kind (ingested without a rule)', () => {
    expect(
      shouldIngestAlertingV2Episode({
        source: 'pagerduty',
      })
    ).toEqual({ ingest: true });
  });
});
