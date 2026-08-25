/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { quoteEsqlSource, toFromQuery } from './esql_from';

describe('quoteEsqlSource', () => {
  it('wraps names in backticks', () => {
    expect(quoteEsqlSource('logs-foo')).toBe('`logs-foo`');
  });

  it('escapes backticks by doubling them', () => {
    expect(quoteEsqlSource('weird`name')).toBe('`weird``name`');
  });
});

describe('toFromQuery', () => {
  it('joins quoted data stream names', () => {
    expect(toFromQuery(['logs-foo', 'metrics.bar'])).toBe('FROM `logs-foo`, `metrics.bar`');
  });

  it('throws when the list is empty', () => {
    expect(() => toFromQuery([])).toThrow('At least one data stream is required');
  });
});
