/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { matchesKnowledgeIndicatorView } from './get_knowledge_indicator_view';

describe('matchesKnowledgeIndicatorView', () => {
  it('puts entity, technology, infrastructure, and dependency on topology', () => {
    expect(matchesKnowledgeIndicatorView('entity', 'topology')).toBe(true);
    expect(matchesKnowledgeIndicatorView('technology', 'topology')).toBe(true);
    expect(matchesKnowledgeIndicatorView('infrastructure', 'topology')).toBe(true);
    expect(matchesKnowledgeIndicatorView('dependency', 'topology')).toBe(true);
    expect(matchesKnowledgeIndicatorView('schema', 'topology')).toBe(false);
    expect(matchesKnowledgeIndicatorView('match_query', 'topology')).toBe(false);
  });

  it('puts match and stats queries on queries', () => {
    expect(matchesKnowledgeIndicatorView('match_query', 'queries')).toBe(true);
    expect(matchesKnowledgeIndicatorView('stats_query', 'queries')).toBe(true);
    expect(matchesKnowledgeIndicatorView('entity', 'queries')).toBe(false);
  });

  it('puts schema, computed, and unknown types on more', () => {
    expect(matchesKnowledgeIndicatorView('schema', 'more')).toBe(true);
    expect(matchesKnowledgeIndicatorView('dataset_analysis', 'more')).toBe(true);
    expect(matchesKnowledgeIndicatorView('log_samples', 'more')).toBe(true);
    expect(matchesKnowledgeIndicatorView('custom_type', 'more')).toBe(true);
    expect(matchesKnowledgeIndicatorView('entity', 'more')).toBe(false);
    expect(matchesKnowledgeIndicatorView('match_query', 'more')).toBe(false);
  });
});
