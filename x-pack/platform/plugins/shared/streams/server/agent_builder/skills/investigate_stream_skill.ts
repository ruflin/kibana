/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';

export const investigateStreamSkill = defineSkillType({
  id: 'streams.investigate_stream',
  name: 'investigate-stream',
  basePath: 'skills/streams',
  description:
    'Performs a comprehensive investigation of a stream: searches events, analyzes log patterns, runs log rate analysis, and examines change points to identify issues.',
  content: `# Investigate Stream Skill

## Overview

Use this skill to perform a comprehensive investigation of a data stream.
It combines multiple analysis tools to build a complete picture of what's happening.

## Process

### 1. Get Context
- Use \`${internalNamespaces.streams}.get_stream_features\` to understand what systems are present.
- Use \`${internalNamespaces.streams}.get_query_definitions\` to see existing queries and their configurations.

### 2. Analyze Patterns
- Use \`${internalNamespaces.streams}.get_log_patterns\` to identify the dominant log patterns and their frequencies.
- Focus on error patterns and unusual patterns that deviate from the norm.

### 3. Detect Changes
- Use \`${internalNamespaces.streams}.get_sig_events_with_change_points\` to find statistically significant changes.
- Prioritize non-stationary change points (spikes, dips, step changes) with low p-values.

### 4. Deep Dive
- Use \`${internalNamespaces.streams}.search_events\` to run ad-hoc ES|QL queries for deeper investigation.
- Use \`${internalNamespaces.streams}.run_log_rate_analysis\` to compare baseline vs deviation windows.
- Use \`${internalNamespaces.streams}.get_query_results\` to examine specific query results.

### 5. Correlate
- Look for patterns that span multiple features or queries.
- Identify root causes by correlating timing of changes across different signals.

## Best Practices
- Start broad (patterns, change points) then narrow down to specific events.
- Always check both error rates AND throughput — a drop in throughput can be as significant as a spike in errors.
- Use time-bounded queries to focus on the relevant window.`,
  getRegistryTools: () => [
    `${internalNamespaces.streams}.get_stream_features`,
    `${internalNamespaces.streams}.get_query_definitions`,
    `${internalNamespaces.streams}.get_log_patterns`,
    `${internalNamespaces.streams}.get_sig_events_with_change_points`,
    `${internalNamespaces.streams}.search_events`,
    `${internalNamespaces.streams}.run_log_rate_analysis`,
    `${internalNamespaces.streams}.get_query_results`,
  ],
});
