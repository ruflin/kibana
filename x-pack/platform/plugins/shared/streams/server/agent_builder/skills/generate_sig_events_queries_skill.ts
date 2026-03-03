/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';

export const generateSigEventsQueriesSkill = defineSkillType({
  id: 'streams.generate_sig_events_queries',
  name: 'generate-sig-events-queries',
  basePath: 'skills/streams',
  description:
    'Generates KQL and ES|QL sig events queries for streams based on features and change point analysis.',
  content: `# Generate Sig Events Queries Skill

## Overview

Use this skill to generate detection queries for significant events in streams.
Queries can be row-based (KQL filters) or STATS-based (ES|QL aggregations).

## Process

### 1. Get Stream Features
- Use \`${internalNamespaces.streams}.get_stream_features\` to understand what systems are present.

### 2. Review Existing Queries
- Use \`${internalNamespaces.streams}.get_sig_events_queries\` to see what queries already exist.
- Avoid duplicating existing detection patterns.

### 3. Analyze Change Points
- Use \`${internalNamespaces.streams}.get_sig_events_with_change_points\` to identify which patterns show significant changes.
- Use this data to inform query thresholds and conditions.

### 4. Generate Queries
- Use \`${internalNamespaces.streams}.upsert_sig_events_queries\` to persist new queries.
- Use \`query_type: 'row'\` for event-level detection (KQL filters).
- Use \`query_type: 'stats'\` for aggregation-based detection (ES|QL STATS).

## Query Design Guidelines
- Row queries: \`FROM stream | WHERE KQL("condition")\` — for detecting specific event patterns.
- Stats queries: \`FROM stream | STATS count = COUNT(*) BY field\` — for detecting volume changes, rate anomalies.
- Use STATS queries when the detection involves patterns across many events.
- Use row queries for specific error conditions or event types.`,
  getRegistryTools: () => [
    `${internalNamespaces.streams}.get_stream_features`,
    `${internalNamespaces.streams}.get_sig_events_queries`,
    `${internalNamespaces.streams}.upsert_sig_events_queries`,
    `${internalNamespaces.streams}.get_sig_events_with_change_points`,
  ],
});
