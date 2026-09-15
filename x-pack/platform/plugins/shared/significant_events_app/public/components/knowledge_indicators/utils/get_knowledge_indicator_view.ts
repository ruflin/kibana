/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MATCH_QUERY_TYPE, STATS_QUERY_TYPE } from './get_knowledge_indicator_type';

export const TOPOLOGY_KI_TYPES = ['entity', 'technology', 'infrastructure', 'dependency'] as const;

export const QUERY_KI_TYPES = [MATCH_QUERY_TYPE, STATS_QUERY_TYPE] as const;

export type KnowledgeIndicatorView = 'topology' | 'queries' | 'more';

const TOPOLOGY_KI_TYPES_SET = new Set<string>(TOPOLOGY_KI_TYPES);
const QUERY_KI_TYPES_SET = new Set<string>(QUERY_KI_TYPES);

export function matchesKnowledgeIndicatorView(type: string, view: KnowledgeIndicatorView): boolean {
  switch (view) {
    case 'topology':
      return TOPOLOGY_KI_TYPES_SET.has(type);
    case 'queries':
      return QUERY_KI_TYPES_SET.has(type);
    case 'more':
      return !TOPOLOGY_KI_TYPES_SET.has(type) && !QUERY_KI_TYPES_SET.has(type);
  }
}
