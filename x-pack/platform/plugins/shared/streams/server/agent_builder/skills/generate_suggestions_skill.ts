/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';

export const generateSuggestionsSkill = defineSkillType({
  id: 'streams.generate_suggestions',
  name: 'generate-suggestions',
  basePath: 'skills/streams',
  description:
    'Generates ES|QL query suggestions from discoveries, categorized by type (alert, dashboard, SLO, viz).',
  content: `# Generate Suggestions Skill

## Overview

Use this skill to generate actionable ES|QL query suggestions from discoveries.
Each suggestion is an ES|QL query that can be used to create alerts, dashboards, SLOs, or visualizations.

## Process

### 1. Search Discoveries
- Use \`${internalNamespaces.streams}.search_discoveries\` to find high-relevance discoveries.
- Focus on discoveries with relevance_score > 50.

### 2. Get Discovery Details
- Use \`${internalNamespaces.streams}.get_discovery\` to get full evidence and recommendations.

### 3. Get Stream Context
- Use \`${internalNamespaces.streams}.get_stream_features\` for field and system context.
- Use \`${internalNamespaces.streams}.get_sig_events_queries\` for existing query patterns.
- Use \`${internalNamespaces.streams}.get_sig_events_with_change_points\` for threshold guidance.

### 4. Generate ES|QL Queries
For each high-relevance discovery, generate 1-3 ES|QL queries and classify each by type:

- **alert**: Detects a condition that should trigger an alert rule.
  Use STATS for threshold alerts, row queries for event-level alerts.
- **dashboard**: Powers a full dashboard with multiple panels.
  Use STATS with BUCKET for time-series data.
- **slo**: Measures a service level indicator.
  Use STATS with COUNT_IF for good/total ratio calculations.
- **viz**: Powers a single visualization.
  Use STATS for aggregated views, row queries for tables.

## Priority Derivation
- critical/high relevance_score (>70) → critical/high priority suggestions
- medium relevance_score (40-70) → medium priority
- low relevance_score (<40) → low priority`,
  getRegistryTools: () => [
    `${internalNamespaces.streams}.search_discoveries`,
    `${internalNamespaces.streams}.get_discovery`,
    `${internalNamespaces.streams}.get_stream_features`,
    `${internalNamespaces.streams}.get_sig_events_queries`,
    `${internalNamespaces.streams}.get_sig_events_with_change_points`,
  ],
});
