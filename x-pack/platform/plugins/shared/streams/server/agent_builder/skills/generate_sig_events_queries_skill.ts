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
    'Generates KQL and ES|QL sig events queries for streams: detection, exclusion (noise-canceling), stats (aggregation metrics), baseline, and correlation queries.',
  content: `# Generate Sig Events Queries Skill

## Overview

Use this skill to generate queries for significant events in streams. Queries serve different
purposes and must be tagged with the correct \`query_purpose\` when calling
\`${internalNamespaces.streams}.upsert_sig_events_queries\`.

### Query Purposes

| purpose       | query_type | Description |
|---------------|------------|-------------|
| \`detection\`   | row        | Detects specific significant events: errors, failures, anomalies. |
| \`exclusion\`   | row        | Noise-canceling: identifies known-noisy patterns to suppress (health checks, heartbeats, debug logs). |
| \`stats\`       | stats      | Aggregation metrics: error rates, throughput, latency percentiles, status code distributions. |
| \`baseline\`    | stats      | Normal operating range references used as anchors for anomaly detection. |
| \`correlation\` | stats      | Co-occurrence analysis across fields or streams to surface related patterns. |

## Process

### 1. Get Stream Features
- Use \`${internalNamespaces.streams}.get_stream_features\` to understand what systems are present.

### 2. Review Existing Queries
- Use \`${internalNamespaces.streams}.get_query_definitions\` to see what queries already exist and which purposes are covered.
- Avoid duplicating existing patterns. Check both \`query_purpose\` and \`kql\` to identify gaps.

### 3. Identify Noisy Patterns (for exclusion queries)
- Use \`${internalNamespaces.streams}.get_log_patterns\` to find the highest-volume log patterns.
- Patterns that are routine and operationally uninteresting (health checks, heartbeats, successful
  routine operations, debug-level messages) should become \`exclusion\` queries.

### 4. Analyze Change Points (for detection and stats queries)
- Use \`${internalNamespaces.streams}.get_sig_events_with_change_points\` to identify which patterns show significant changes.
- Use this data to inform detection query conditions and stats query time buckets.

### 5. Generate Queries
Use \`${internalNamespaces.streams}.upsert_sig_events_queries\` to persist new queries.

## Query Design Guidelines

### Detection queries (\`query_purpose: 'detection'\`, \`query_type: 'row'\`)
- Target specific error conditions, failures, or anomalies using KQL.
- Example: \`log.level: "error" AND message: "connection refused"\`
- Keep queries focused — one pattern per query.

### Exclusion queries (\`query_purpose: 'exclusion'\`, \`query_type: 'row'\`)
- Match high-volume, low-signal patterns that should be filtered out.
- Example: \`message: "health check" OR message: "heartbeat" OR message: "ping"\`
- Use \`get_log_patterns\` to identify the top noisy patterns first.
- These are NOT used for alerting — they suppress noise in the significant events view.

### Stats queries (\`query_purpose: 'stats'\`, \`query_type: 'stats'\`)
- Provide aggregation-based metrics that indicate something important happened.
- Must include a full ES|QL query in \`esql_query\` (the \`kql\` field can be \`"*"\`).
- Common stats patterns:
  - **Error rate**: \`FROM <stream> | STATS error_rate = COUNT_IF(http.response.status_code >= 500) / COUNT(*) BY BUCKET(@timestamp, 5m)\`
  - **Throughput**: \`FROM <stream> | STATS request_count = COUNT(*) BY BUCKET(@timestamp, 1m), service.name\`
  - **Latency percentiles**: \`FROM <stream> | STATS p50 = PERCENTILE(event.duration, 50), p99 = PERCENTILE(event.duration, 99) BY BUCKET(@timestamp, 5m)\`
  - **Status code distribution**: \`FROM <stream> | STATS count = COUNT(*) BY http.response.status_code | SORT count DESC\`
  - **Top errors by service**: \`FROM <stream> | WHERE log.level == "error" | STATS error_count = COUNT(*) BY service.name | SORT error_count DESC\`
  - **Cardinality (unique values)**: \`FROM <stream> | STATS unique_users = COUNT_DISTINCT(user.id) BY BUCKET(@timestamp, 5m)\`

### Baseline queries (\`query_purpose: 'baseline'\`, \`query_type: 'stats'\`)
- Capture normal operating ranges as reference anchors.
- Must include a full ES|QL query in \`esql_query\`.
- Example: \`FROM <stream> | STATS avg_rate = AVG(event.duration), stddev_rate = STDDEV(event.duration) BY service.name\`

### Correlation queries (\`query_purpose: 'correlation'\`, \`query_type: 'stats'\`)
- Surface co-occurring patterns across fields or streams.
- Must include a full ES|QL query in \`esql_query\`.
- Example: \`FROM <stream> | WHERE log.level == "error" | STATS count = COUNT(*) BY error.type, service.name | SORT count DESC\`

## Coverage Checklist

For each stream, aim to generate at least:
1. Detection queries for the most important error/failure patterns
2. Exclusion queries for the top noisy/routine patterns
3. Stats queries for error rate and throughput over time
4. A baseline query for normal operating range`,
  getRegistryTools: () => [
    `${internalNamespaces.streams}.get_stream_features`,
    `${internalNamespaces.streams}.get_sig_events_queries`,
    `${internalNamespaces.streams}.get_query_definitions`,
    `${internalNamespaces.streams}.upsert_sig_events_queries`,
    `${internalNamespaces.streams}.get_sig_events_with_change_points`,
    `${internalNamespaces.streams}.get_log_patterns`,
  ],
});
