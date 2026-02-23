/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SkillDefinition } from '@kbn/agent-builder-server/skills';
import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { platformCoreTools } from '@kbn/agent-builder-common';
import { STREAMS_SEARCH_INSIGHTS_TOOL_ID } from '../../tools/streams/search_insights/tool';
import { STREAMS_WRITE_INSIGHT_TOOL_ID } from '../../tools/streams/write_insight/tool';
import { STREAMS_SUGGEST_QUERY_TOOL_ID } from '../../tools/streams/suggest_query/tool';

const ID = 'observability_correlation';
const NAME = 'observability-correlation';
const BASE_PATH = 'skills/observability';

const SKILL_CONTENT = `# Observability Correlation

This skill correlates signals across multiple observability data sources — logs, APM traces,
infrastructure metrics, and alerts — to find cross-signal patterns that are invisible when
looking at any single source in isolation.

## When to use this skill

Use this skill when:
- An incident involves multiple services or infrastructure components
- You need to understand the cascade of failures across a system
- Correlating log errors with APM latency spikes or infrastructure resource pressure
- Looking for the root cause of a system-wide degradation
- Building a timeline of events across multiple data sources

## Available data sources

### Logs and Streams
- \`streams.search_features\` — Known system components and their relationships
- \`streams.search_queries\` — Significant event detectors
- \`${STREAMS_SEARCH_INSIGHTS_TOOL_ID}\` — Previous investigation findings
- \`streams.semantic_correlate\` — Semantic similarity across features and queries
- \`${platformCoreTools.executeEsql}\` on \`logs-generic-default\` — Raw log data
- \`${platformCoreTools.executeEsql}\` on \`.alerts-streams.alerts-default\` — Significant events

### APM and Services
- \`observability.get_services\` — Service list with health, latency, error rate, throughput
- \`observability.get_service_topology\` — Service dependency graph with RED metrics per edge
- \`observability.get_trace_metrics\` — Time-series trace metrics (latency, throughput, errors)
- \`observability.get_traces\` — Full trace documents for specific trace IDs

### Infrastructure
- \`observability.get_hosts\` — Host list with resource metrics
- \`observability.get_runtime_metrics\` — Runtime/system metrics (CPU, memory)

### Alerts
- \`observability.get_alerts\` — Active alerts across all Observability rule types

### Statistical analysis
- \`observability.diff_count\` — Compare categorical distributions before/after
- \`observability.diff_metric\` — Compare metric distributions before/after
- \`observability.detect_change_points\` — Find when behavior changed
- \`observability.attribute_impact\` — Decompose WHY a metric changed
- \`observability.bubble_up\` — Find over-represented attributes in a problem set

## Methodology

### 1. Establish the incident scope
- Use \`observability.get_alerts\` to see what's currently firing
- Use \`${STREAMS_SEARCH_INSIGHTS_TOOL_ID}\` to check for related past investigations
- Identify the time window of interest

### 2. Map the affected services
- Use \`observability.get_services\` to get service health overview
- For degraded services, use \`observability.get_service_topology\` to see upstream/downstream
- Use \`streams.search_features\` to find stream features for affected services
- Build a picture: which services are affected, and how are they connected?

### 3. Correlate across signals
For each affected service, gather evidence from multiple sources:

**Logs**: Use \`${platformCoreTools.executeEsql}\` to query error patterns:
\`FROM logs-generic-default | WHERE service.name == "X" AND @timestamp >= NOW() - 1 HOUR
| STATS error_count = COUNT(*) BY log.level | SORT error_count DESC\`

**APM**: Use \`observability.get_trace_metrics\` to check latency and error rate trends

**Infrastructure**: Use \`observability.get_hosts\` and \`observability.get_runtime_metrics\`
to check for resource pressure (CPU, memory, disk)

**Significant events**: Use \`${platformCoreTools.executeEsql}\` on \`.alerts-streams.alerts-default\`
to see which significant event queries are firing

### 4. Build a timeline
Order events chronologically across all data sources:
1. When did the first signal appear? (earliest alert, first error spike, first latency increase)
2. What happened next? (cascade to dependent services, resource exhaustion)
3. What is the current state? (ongoing, recovering, resolved)

Use \`observability.detect_change_points\` on key metrics to pinpoint exact transition times.

### 5. Identify the root cause
- Use \`observability.attribute_impact\` to decompose metric changes into per-attribute contributions
- Use \`observability.bubble_up\` on log data to find what's different about error requests
- Use \`observability.diff_count\` to compare alert distributions before/after the incident
- Cross-reference with \`streams.semantic_correlate\` to find features related to the root cause

### 6. Record findings
- Use \`${STREAMS_WRITE_INSIGHT_TOOL_ID}\` to persist the cross-signal correlation finding
  - Category should be "correlation" for cross-signal findings
  - Evidence should reference specific services, metrics, and time ranges
  - Recommendations should be actionable and specific
- Use \`${STREAMS_SUGGEST_QUERY_TOOL_ID}\` if the root cause pattern should be monitored

## Cross-signal correlation patterns

### Cascading failure
**Signal**: Service A errors → Service B timeouts → Service C queue backup
**How to detect**: Service topology shows A → B → C; error rates propagate downstream
with increasing latency at each hop.

### Resource exhaustion
**Signal**: Host CPU/memory spike → container OOMKilled → service restarts → error spike
**How to detect**: Infrastructure metrics show resource pressure before application errors begin.
Timeline shows infra signal precedes app signal.

### Deployment-correlated regression
**Signal**: Change point in latency/errors coincides with deployment timestamp
**How to detect**: \`detect_change_points\` on latency shows step change; timestamp correlates
with deployment events in logs.

### Noisy neighbor
**Signal**: One service's resource usage crowds out others on the same host
**How to detect**: \`attribute_impact\` on host CPU shows one service contributing disproportionately;
other services on the same host show degradation.

### Database bottleneck
**Signal**: Multiple services show increased latency; all share a common database dependency
**How to detect**: Service topology converges on a single database; database metrics show
connection pool exhaustion or slow queries.

## Constraints

- Always establish a clear time window before investigating
- Correlate at least two different signal types before claiming a root cause
- Include specific timestamps and metric values in evidence
- Distinguish correlation from causation — note confidence level
- Record findings as insights with category "correlation"
- Keep the investigation focused — don't chase every anomaly
`;

const CORRELATION_CHECKLIST_CONTENT = `# Cross-Signal Correlation Checklist

## Data collection (gather before analyzing)

| Signal type | Tool | What to collect |
|-------------|------|----------------|
| Active alerts | \`observability.get_alerts\` | Alert names, rule types, affected entities |
| Service health | \`observability.get_services\` | Latency, error rate, throughput per service |
| Service topology | \`observability.get_service_topology\` | Dependency graph, RED metrics per edge |
| Host resources | \`observability.get_hosts\` | CPU, memory, disk per host |
| Log errors | \`platform.core.execute_esql\` | Error counts by service, log level distribution |
| Significant events | \`platform.core.execute_esql\` | Alert counts by rule name from .alerts-streams |
| Past insights | \`streams.search_insights\` | Previous findings for affected streams |
| Stream features | \`streams.search_features\` | Known components and dependencies |

## Analysis sequence

1. **Scope**: What services/hosts are affected? (get_services, get_hosts)
2. **Timeline**: When did it start? (detect_change_points on key metrics)
3. **Topology**: How are affected components connected? (get_service_topology)
4. **Attribution**: What changed? (diff_count on logs, attribute_impact on metrics)
5. **Root cause**: Why did it change? (bubble_up on error logs, infrastructure correlation)
6. **Record**: Persist the finding (write_insight with category "correlation")

## Correlation strength assessment

| Evidence | Confidence modifier |
|----------|-------------------|
| Two signals from same service, same time window | +20 |
| Topology shows direct dependency between affected services | +15 |
| Change point timestamps within 5 minutes of each other | +15 |
| Infrastructure metric precedes application metric | +10 (suggests causation) |
| Only one signal type shows anomaly | -20 (weak correlation) |
| Signals from unrelated services | -15 (may be coincidence) |
`;

export const createObservabilityCorrelationSkill = (): SkillDefinition<
  typeof NAME,
  typeof BASE_PATH
> => {
  return defineSkillType({
    id: ID,
    name: NAME,
    basePath: BASE_PATH,
    description:
      'Correlate signals across logs, APM, infrastructure, and alerts to find cross-signal patterns and root causes for system-wide incidents.',
    content: SKILL_CONTENT,
    referencedContent: [
      {
        relativePath: '.',
        name: 'correlation-checklist',
        content: CORRELATION_CHECKLIST_CONTENT,
      },
    ],
    getRegistryTools: () => [
      platformCoreTools.search,
      platformCoreTools.executeEsql,
      'streams.search_features',
      'streams.search_queries',
      'streams.semantic_correlate',
      'observability.get_alerts',
      'observability.get_services',
      'observability.get_service_topology',
      'observability.get_hosts',
      'observability.get_trace_metrics',
      'observability.get_runtime_metrics',
      'observability.diff_count',
      'observability.diff_metric',
      'observability.detect_change_points',
      'observability.attribute_impact',
      'observability.bubble_up',
      STREAMS_SEARCH_INSIGHTS_TOOL_ID,
      STREAMS_WRITE_INSIGHT_TOOL_ID,
      STREAMS_SUGGEST_QUERY_TOOL_ID,
    ],
    getInlineTools: () => [],
  });
};
