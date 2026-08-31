/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE } from '@kbn/significant-events-schema';
import { METRIC_SERIES_RULE_TAG } from '../rules/metric_series_contract';

export type AlertingV2RuleKind = 'alert' | 'signal';

export interface AlertingV2EpisodeIngestCandidate {
  source: string;
  kind?: AlertingV2RuleKind;
  ruleTags?: string[];
}

export type AlertingV2EpisodeIngestSkipReason =
  | 'source_significant_events'
  | 'kind_signal'
  | 'sigevents_match_count_rule';

export type ShouldIngestAlertingV2EpisodeResult =
  | { ingest: true }
  | { ingest: false; reason: AlertingV2EpisodeIngestSkipReason };

/**
 * Direction B loop filter. Drops promotions we created (Direction A), SIG-owned
 * KI match-count signal rules, and any `kind: signal` series (no episode).
 *
 * Stream ownership tags (`sigevents:stream:*`) are **not** a skip reason on their
 * own: they are a join key for user alert rules that opt into correlation.
 */
export const shouldIngestAlertingV2Episode = (
  candidate: AlertingV2EpisodeIngestCandidate
): ShouldIngestAlertingV2EpisodeResult => {
  if (candidate.source === SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE) {
    return { ingest: false, reason: 'source_significant_events' };
  }

  if (candidate.kind === 'signal') {
    return { ingest: false, reason: 'kind_signal' };
  }

  if ((candidate.ruleTags ?? []).includes(METRIC_SERIES_RULE_TAG)) {
    return { ingest: false, reason: 'sigevents_match_count_rule' };
  }

  return { ingest: true };
};
