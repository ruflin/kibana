/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ListStreamDetail } from '@kbn/streams-plugin/server/routes/internal/streams/crud/route';
import { enrichStream, isSignificantEventsEligibleStream } from './utils';

const STUB_STREAM_FIELDS = {
  description: '',
  updated_at: '2025-01-01T00:00:00Z',
} as const;

const wiredStream = (name: string): ListStreamDetail => ({
  stream: {
    name,
    type: 'wired',
    ingest: {
      processing: { steps: [], updated_at: '' },
      lifecycle: { inherit: {} },
      settings: {},
      failure_store: { disabled: {} },
      wired: { fields: {}, routing: [] },
    },
    ...STUB_STREAM_FIELDS,
  },
  effective_lifecycle: { dsl: { data_retention: '7d' } },
  privileges: { read_failure_store: false },
});

const classicStream = (name: string): ListStreamDetail => ({
  stream: {
    name,
    type: 'classic',
    ingest: {
      processing: { steps: [], updated_at: '' },
      lifecycle: { inherit: {} },
      settings: {},
      failure_store: { disabled: {} },
      classic: {},
    },
    ...STUB_STREAM_FIELDS,
  },
  effective_lifecycle: { inherit: {} },
  privileges: { read_failure_store: false },
});

// Query streams are returned by GET /internal/streams without effective_lifecycle/data_stream.
const queryStream = (name: string): ListStreamDetail => ({
  stream: {
    name,
    type: 'query',
    query: { esql: `FROM ${name}*`, view: `$.${name}` },
    ...STUB_STREAM_FIELDS,
  },
  privileges: { read_failure_store: false },
});

describe('isSignificantEventsEligibleStream', () => {
  it('includes wired streams', () => {
    expect(isSignificantEventsEligibleStream(wiredStream('logs'))).toBe(true);
  });

  it('includes classic streams', () => {
    expect(isSignificantEventsEligibleStream(classicStream('logs-nginx-default'))).toBe(true);
  });

  it('includes query streams', () => {
    expect(isSignificantEventsEligibleStream(queryStream('logs'))).toBe(true);
  });
});

describe('enrichStream', () => {
  it('marks query streams with type "query" and zero retention', () => {
    const enriched = enrichStream(queryStream('logs'));

    expect(enriched.type).toBe('query');
    // Query streams have no effective_lifecycle, so retention is not applicable.
    expect(enriched.retentionMs).toBe(0);
    expect(enriched.nameSortKey).toBe('logs');
  });

  it('does not throw when a query stream has no effective_lifecycle', () => {
    expect(() => enrichStream(queryStream('logs'))).not.toThrow();
  });

  it('marks classic streams with type "classic"', () => {
    expect(enrichStream(classicStream('logs-nginx-default')).type).toBe('classic');
  });

  it('derives retention from a wired stream dsl lifecycle', () => {
    const enriched = enrichStream(wiredStream('logs'));

    expect(enriched.type).toBe('wired');
    expect(enriched.retentionMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
