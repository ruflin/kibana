/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  blastRadiusEntrySchema,
  causalFeatureSchema,
  signalEntrySchema,
  significantEventAlertingV2ProvenanceSchema,
  SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE,
} from './common_schemas';

const metadata = {
  detection_id: 'det-1',
  rule_uuid: 'rule-1',
  change_point_type: 'spike' as const,
  p_value: 0.01,
};

const parseSignal = (
  overrides: Record<string, unknown>
): ReturnType<typeof signalEntrySchema.safeParse> =>
  signalEntrySchema.safeParse({
    type: 'detection',
    stream_name: 'logs.test',
    description: 'Found: payment refused. Impact: checkout blocked.',
    collected_at: '2026-07-20T08:00:00.000Z',
    metadata,
    ...overrides,
  });

const evidence = (result: 'found' | 'empty' | 'error') => ({
  esql_query: 'FROM logs.test | LIMIT 1',
  result,
});

describe('signalEntrySchema verdict/evidence consistency', () => {
  it('rejects confirms with empty evidence', () => {
    expect(parseSignal({ verdict: 'confirms', evidence: evidence('empty') }).success).toBe(false);
  });

  it('rejects off_topic with empty evidence', () => {
    expect(parseSignal({ verdict: 'off_topic', evidence: evidence('empty') }).success).toBe(false);
  });

  it('accepts refutes with found evidence', () => {
    expect(parseSignal({ verdict: 'refutes', evidence: evidence('found') }).success).toBe(true);
  });

  it('accepts refutes with empty evidence', () => {
    expect(parseSignal({ verdict: 'refutes', evidence: evidence('empty') }).success).toBe(true);
  });

  it('rejects refutes with error evidence', () => {
    expect(parseSignal({ verdict: 'refutes', evidence: evidence('error') }).success).toBe(false);
  });

  it('rejects refutes when evidence is omitted', () => {
    expect(parseSignal({ verdict: 'refutes' }).success).toBe(false);
  });

  it('rejects refutes when evidence is null', () => {
    expect(parseSignal({ verdict: 'refutes', evidence: null }).success).toBe(false);
  });

  it('rejects inconclusive with found evidence', () => {
    expect(parseSignal({ verdict: 'inconclusive', evidence: evidence('found') }).success).toBe(
      false
    );
  });

  it('accepts inconclusive with empty evidence', () => {
    expect(parseSignal({ verdict: 'inconclusive', evidence: evidence('empty') }).success).toBe(
      true
    );
  });

  it('rejects not_checked with query evidence', () => {
    expect(parseSignal({ verdict: 'not_checked', evidence: evidence('found') }).success).toBe(
      false
    );
  });

  it('accepts not_checked when evidence is omitted', () => {
    expect(parseSignal({ verdict: 'not_checked' }).success).toBe(true);
  });
});

describe('topology classification compatibility', () => {
  it.each([
    {
      type: 'dependency',
      feature_id: 'orders-db',
      source: 'orders-api',
      target: 'postgres',
      stream_name: 'logs.orders',
    },
    {
      type: 'infrastructure',
      feature_id: 'orders-cluster',
      stream_name: 'logs.orders',
    },
    {
      type: 'entity',
      feature_id: 'orders-api',
      name: 'orders-api',
      stream_name: 'logs.orders',
    },
  ])('accepts legacy $type blast-radius rows without subtype', (entry) => {
    expect(blastRadiusEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('accepts legacy causal features without classification', () => {
    expect(
      causalFeatureSchema.safeParse({
        feature_id: 'orders-api',
        name: 'orders-api',
        stream_name: 'logs.orders',
      }).success
    ).toBe(true);
  });
});

describe('alerting_v2_episode signal type', () => {
  const episodeSignal = {
    type: 'alerting_v2_episode' as const,
    stream_name: 'logs.checkout',
    description: 'User alert episode joined this open significant event.',
    verdict: 'confirms' as const,
    collected_at: '2026-08-31T12:00:00.000Z',
    metadata: {
      episode_id: 'ep-1',
      group_hash: 'abc123',
      rule_id: 'user-rule-1',
      rule_name: 'Checkout error rate',
      source: 'datadog',
      episode_status: 'active' as const,
      severity: 'high' as const,
    },
  };

  it('accepts an alerting_v2_episode signal without ES|QL evidence', () => {
    expect(signalEntrySchema.safeParse(episodeSignal).success).toBe(true);
  });

  it('rejects a detection-shaped payload tagged as alerting_v2_episode', () => {
    expect(
      signalEntrySchema.safeParse({
        ...episodeSignal,
        type: 'alerting_v2_episode',
        metadata: {
          detection_id: 'det-1',
          rule_uuid: 'rule-1',
          change_point_type: 'spike',
          p_value: 0.01,
        },
      }).success
    ).toBe(false);
  });

  it('still accepts detection signals after the union grew', () => {
    expect(
      parseSignal({ verdict: 'confirms', evidence: evidence('found') }).success
    ).toBe(true);
  });
});

describe('significantEventAlertingV2ProvenanceSchema', () => {
  it('accepts Direction A provenance with the significant_events source', () => {
    expect(
      significantEventAlertingV2ProvenanceSchema.safeParse({
        source: SIGNIFICANT_EVENTS_ALERTING_V2_SOURCE,
        group_hash: 'deadbeef',
        episode_id: 'ep-1',
        last_alert_status: 'active',
        last_synced_at: '2026-08-31T12:00:00.000Z',
      }).success
    ).toBe(true);
  });

  it('rejects a reserved elastic-* source on SIG provenance', () => {
    expect(
      significantEventAlertingV2ProvenanceSchema.safeParse({
        source: 'elastic-significant-events',
        group_hash: 'deadbeef',
        episode_id: 'ep-1',
      }).success
    ).toBe(false);
  });
});
