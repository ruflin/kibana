/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { computeFeatureUuid } from '@kbn/significant-events-schema';
import type {
  StoredFeatureKnowledgeIndicator,
  StoredQueryKnowledgeIndicator,
  StoredTombstone,
} from '../data_stream';
import { KI_TYPE_FEATURE, KI_TYPE_QUERY } from '../fields';
import { toAiIndexDeleteOperations, toAiIndexKiOperations } from './to_ai_index_ki';

const STREAM = 'logs-app';

const featureUuid = (slug: string): string => computeFeatureUuid({ id: slug, stream_name: STREAM });

const createFeatureDoc = (
  overrides: Partial<StoredFeatureKnowledgeIndicator> & { slug?: string } = {}
): StoredFeatureKnowledgeIndicator => {
  const { slug = 'checkout', ...rest } = overrides;
  return {
    '@timestamp': '2026-01-01T00:00:00.000Z',
    id: featureUuid(slug),
    type: KI_TYPE_FEATURE,
    'stream.name': STREAM,
    title: 'Checkout service',
    description: 'Handles checkout',
    tags: ['payments'],
    evidence: ['error.rate spiked'],
    expires_at: '2026-01-31T00:00:00.000Z',
    run_id: 'run-1',
    feature: {
      slug,
      type: 'entity',
      subtype: 'service',
      properties: { name: 'checkout' },
      confidence: 80,
      evidence_doc_ids: ['doc-1'],
      meta: { source: 'inferred' },
    },
    ...rest,
  };
};

const createQueryDoc = (
  overrides: Partial<StoredQueryKnowledgeIndicator> = {}
): StoredQueryKnowledgeIndicator => ({
  '@timestamp': '2026-01-01T00:00:00.000Z',
  id: 'high-error-rate',
  type: KI_TYPE_QUERY,
  'stream.name': STREAM,
  title: 'High error rate',
  description: 'Fires when errors exceed 20%',
  evidence: ['error ratio 0.22'],
  expires_at: '2026-01-31T00:00:00.000Z',
  query: {
    esql: 'FROM logs-app | STATS errors = COUNT(*) WHERE log.level == "error"',
    query_type: 'stats',
    rule_backed: false,
    rule_id: 'rule-1',
    severity_score: 60,
    features: [{ id: 'checkout' }],
  },
  ...overrides,
});

describe('toAiIndexKiOperations', () => {
  it('maps a feature KI onto type feature with rescaled confidence and no nested payloads', () => {
    const [operation] = toAiIndexKiOperations([createFeatureDoc()]);

    expect(operation).toEqual({
      action: 'upsert',
      id: 'logs-app/checkout',
      document: expect.objectContaining({
        id: 'logs-app/checkout',
        type: 'feature',
        title: 'Checkout service',
        description: 'Handles checkout',
        tags: ['payments'],
        attributes: {
          stream_name: STREAM,
          feature_type: 'entity',
          subtype: 'service',
          slug: 'checkout',
          confidence: 0.8,
          evidence: ['error.rate spiked'],
          evidence_doc_ids: ['doc-1'],
          expires_at: '2026-01-31T00:00:00.000Z',
          run_id: 'run-1',
        },
      }),
    });

    if (operation.action !== 'upsert') {
      throw new Error('expected upsert');
    }
    expect(operation.document.content).toContain('Stream: logs-app');
    expect(operation.document.content).toContain('Title: Checkout service');
    expect(operation.document.attributes).not.toHaveProperty('filter');
    expect(operation.document.attributes).not.toHaveProperty('properties');
    expect(operation.document.attributes).not.toHaveProperty('meta');
  });

  it('keeps confidence in 0-1 when the stored value is already a unit interval', () => {
    const doc = createFeatureDoc();
    doc.feature.confidence = 0.4;
    const [operation] = toAiIndexKiOperations([doc]);

    expect(operation.action).toBe('upsert');
    if (operation.action === 'upsert') {
      expect(operation.document.attributes.confidence).toBe(0.4);
    }
  });

  it('maps a query KI onto type detection with materialized ES|QL', () => {
    const [operation] = toAiIndexKiOperations([createQueryDoc()]);

    expect(operation).toEqual({
      action: 'upsert',
      id: 'logs-app/high-error-rate',
      document: expect.objectContaining({
        type: 'detection',
        title: 'High error rate',
        attributes: {
          stream_name: STREAM,
          esql: 'FROM logs-app | STATS errors = COUNT(*) WHERE log.level == "error"',
          query_type: 'stats',
          severity_score: 0.6,
          rule_backed: false,
          rule_id: 'rule-1',
          feature_ids: ['checkout'],
          evidence: ['error ratio 0.22'],
          expires_at: '2026-01-31T00:00:00.000Z',
        },
      }),
    });
    if (operation.action === 'upsert') {
      expect(operation.document.content).toContain('ES|QL:');
      expect(operation.document.content).toContain('FROM logs-app');
    }
  });

  it('stamps excluded on the projected feature', () => {
    const [operation] = toAiIndexKiOperations([createFeatureDoc({ excluded: true })]);

    expect(operation.action).toBe('upsert');
    if (operation.action === 'upsert') {
      expect(operation.document.attributes.excluded).toBe(true);
    }
  });

  it('deletes query tombstones by stream/query-id', () => {
    const tombstone: StoredTombstone = {
      '@timestamp': '2026-01-02T00:00:00.000Z',
      id: 'high-error-rate',
      type: KI_TYPE_QUERY,
      'stream.name': STREAM,
      deleted: true,
    };

    expect(toAiIndexKiOperations([tombstone])).toEqual([
      { action: 'delete', id: 'logs-app/high-error-rate' },
    ]);
  });

  it('skips feature tombstones that lack a slug', () => {
    const tombstone: StoredTombstone = {
      '@timestamp': '2026-01-02T00:00:00.000Z',
      id: featureUuid('checkout'),
      type: KI_TYPE_FEATURE,
      'stream.name': STREAM,
      deleted: true,
    };

    expect(toAiIndexKiOperations([tombstone])).toEqual([]);
  });

  it('maps a pre-delete feature revision onto a dest delete', () => {
    expect(toAiIndexDeleteOperations([createFeatureDoc()])).toEqual([
      { action: 'delete', id: 'logs-app/checkout' },
    ]);
  });
});
