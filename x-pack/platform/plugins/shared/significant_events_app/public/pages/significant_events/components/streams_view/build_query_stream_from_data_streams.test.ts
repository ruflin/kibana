/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  buildQueryStreamEsqlFromDataStreams,
  classifyDataStreamType,
  quoteEsqlSource,
  toElasticsearchDataStreams,
} from './build_query_stream_from_data_streams';

describe('classifyDataStreamType', () => {
  it('classifies data-stream naming scheme and wired stream names', () => {
    expect(classifyDataStreamType('logs-nginx-default')).toBe('logs');
    expect(classifyDataStreamType('logs.nginx')).toBe('logs');
    expect(classifyDataStreamType('logs')).toBe('logs');
    expect(classifyDataStreamType('metrics-system.cpu-default')).toBe('metrics');
    expect(classifyDataStreamType('metrics.cpu')).toBe('metrics');
    expect(classifyDataStreamType('traces-apm-default')).toBe('other');
    expect(classifyDataStreamType('custom-events')).toBe('other');
  });
});

describe('toElasticsearchDataStreams', () => {
  it('keeps data streams and drops indices, aliases, and hidden names', () => {
    expect(
      toElasticsearchDataStreams([
        { name: 'logs-nginx-default', tags: [{ key: 'data_stream' }] },
        { name: 'metrics-system.cpu-default', tags: [{ key: 'data_stream' }] },
        { name: 'my-index', tags: [{ key: 'index' }] },
        { name: '.internal-alerts', tags: [{ key: 'data_stream' }] },
        { name: 'traces-apm-default', tags: [{ key: 'data_stream' }] },
      ])
    ).toEqual([
      { name: 'logs-nginx-default', type: 'logs' },
      { name: 'metrics-system.cpu-default', type: 'metrics' },
      { name: 'traces-apm-default', type: 'other' },
    ]);
  });
});

describe('quoteEsqlSource', () => {
  it('quotes names with hyphens and leaves simple identifiers unquoted', () => {
    expect(quoteEsqlSource('logs')).toBe('logs');
    expect(quoteEsqlSource('logs.nginx')).toBe('logs.nginx');
    expect(quoteEsqlSource('logs*')).toBe('logs*');
    expect(quoteEsqlSource('logs-nginx-default')).toBe('"logs-nginx-default"');
    expect(quoteEsqlSource('cluster:logs-foo')).toBe('"cluster:logs-foo"');
  });
});

describe('buildQueryStreamEsqlFromDataStreams', () => {
  it('builds a FROM clause over unique sorted data stream names', () => {
    expect(
      buildQueryStreamEsqlFromDataStreams([
        'metrics-system.cpu-default',
        'logs-nginx-default',
        'logs-nginx-default',
      ])
    ).toBe('FROM "logs-nginx-default", "metrics-system.cpu-default"');
  });

  it('throws when no data streams are selected', () => {
    expect(() => buildQueryStreamEsqlFromDataStreams([])).toThrow(
      'At least one data stream is required'
    );
  });
});
