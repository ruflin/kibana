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
import { STREAMS_SUGGEST_QUERY_TOOL_ID } from '../../tools/streams/suggest_query/tool';
import { STREAMS_ANNOTATE_FEATURE_TOOL_ID } from '../../tools/streams/annotate_feature/tool';
import { STREAMS_WRITE_INSIGHT_TOOL_ID } from '../../tools/streams/write_insight/tool';

const ID = 'query_optimization';
const NAME = 'query-optimization';
const BASE_PATH = 'skills/observability';

const SKILL_CONTENT = `# Query Optimization

This skill reviews and improves significant event queries for a stream. It validates existing
queries against live data, identifies monitoring gaps by comparing queries to features, and
proposes new queries to close coverage holes.

## When to use this skill

Use this skill when:
- Reviewing query quality after the automated generation task
- A user asks to improve detection coverage for a stream
- Investigation reveals that important patterns are not being detected
- Queries are producing too many false positives or missing real events

## Methodology

### 1. Inventory existing queries and features
- Use \`streams.search_queries\` with the target stream to list all current queries
- Use \`streams.search_features\` with the target stream to list all features
- Build a mental map: which features have associated queries, which don't?

### 2. Validate queries against live data
- For each query, use \`${platformCoreTools.executeEsql}\` to test the KQL against actual data:
  \`FROM logs-generic-default | WHERE [KQL translated to ES|QL] | STATS count = COUNT(*) | LIMIT 1\`
- Check if the query matches any documents in the last 24 hours
- Queries that match zero documents may be stale or incorrectly constructed
- Queries that match extremely high volumes may be too broad (false positive risk)

### 3. Coverage analysis
- Cross-reference features with queries:
  - **Entity features** should have at least one error/operational query scoped to them
  - **Dependency features** should have connection failure / timeout queries
  - **Technology features** should have technology-specific error pattern queries
  - **Infrastructure features** should have environment-specific failure queries
- Use \`${STREAMS_SEARCH_INSIGHTS_TOOL_ID}\` to find past investigation findings that
  identified patterns not covered by existing queries

### 4. Quality assessment
For each query, evaluate:
- **Specificity**: Does it target a specific failure mode or is it too generic?
- **KQL correctness**: Is the syntax valid? Does it use the right fields?
- **Severity alignment**: Does the severity score match the actual impact?
- **Feature linkage**: Is it linked to the right feature?
- **Evidence grounding**: Is it based on observed log patterns?

### 5. Propose improvements
- Use \`${STREAMS_SUGGEST_QUERY_TOOL_ID}\` to propose new queries for uncovered patterns
- Use \`${STREAMS_ANNOTATE_FEATURE_TOOL_ID}\` to note which features lack query coverage
- Use \`${STREAMS_WRITE_INSIGHT_TOOL_ID}\` to record the coverage analysis as an insight

## Coverage gap patterns

### Common gaps to look for

| Feature type | Expected query categories | Common missing patterns |
|-------------|--------------------------|------------------------|
| Entity (service) | error, operational | Startup failures, health check failures, graceful shutdown |
| Entity (database) | error, resource_health | Connection pool exhaustion, slow queries, deadlocks |
| Entity (queue) | error, operational | Consumer lag, dead letter queue growth, connection failures |
| Dependency (HTTP) | error | Timeout, connection refused, 5xx responses on the path |
| Dependency (DB) | error, resource_health | Authentication failures, query timeout on the connection |
| Technology (Java) | error | OutOfMemoryError, StackOverflowError, ClassNotFoundException |
| Technology (Python) | error | Traceback, ImportError, ConnectionError |
| Technology (Node.js) | error | UnhandledPromiseRejection, ECONNREFUSED, heap out of memory |
| Infrastructure (K8s) | operational, error | Pod eviction, CrashLoopBackOff, OOMKilled, liveness probe failure |
| Infrastructure (cloud) | resource_health | Quota exceeded, throttling, metadata service errors |

### Severity scoring guide

| Category | Base score | Modifiers |
|----------|-----------|-----------|
| security | 70 | +15 privilege escalation, +10 repeated failures |
| error | 60 | +25 crash/OOM, +10 data integrity risk |
| resource_health | 50 | +15 exhaustion, +10 degradation |
| operational | 30 | -10 expected lifecycle events |
| configuration | 25 | +10 security-related changes |

## Constraints

- Never delete existing queries — only propose new ones or annotate existing features
- Test every proposed KQL query against live data before suggesting it
- Include evidence from actual log patterns in query suggestions
- Record the coverage analysis as an insight for future reference
- Limit suggestions to patterns with genuine monitoring value — avoid noise
`;

const QUERY_PATTERNS_CONTENT = `# Technology-Specific Query Patterns

## Java / JVM
- \`body.text:*OutOfMemoryError*\` — JVM heap exhaustion (severity: 85)
- \`body.text:*StackOverflowError*\` — Infinite recursion (severity: 80)
- \`body.text:*ClassNotFoundException*\` — Missing dependency at runtime (severity: 70)
- \`body.text:*java.net.ConnectException*\` — Network connectivity failure (severity: 75)
- \`body.text:*java.sql.SQLException*\` — Database query failure (severity: 70)
- \`body.text:*GC pause*\` — Long garbage collection pauses (severity: 60)

## Python
- \`body.text:*Traceback*\` — Unhandled exception (severity: 65)
- \`body.text:*ConnectionRefusedError*\` — Network failure (severity: 75)
- \`body.text:*MemoryError*\` — Memory exhaustion (severity: 85)
- \`body.text:*ImportError*\` — Missing module (severity: 70)
- \`body.text:*TimeoutError*\` — Operation timeout (severity: 70)

## Node.js / JavaScript
- \`body.text:*UnhandledPromiseRejection*\` — Unhandled async error (severity: 70)
- \`body.text:*ECONNREFUSED*\` — Connection refused (severity: 75)
- \`body.text:*heap out of memory*\` — V8 heap exhaustion (severity: 85)
- \`body.text:*FATAL ERROR*\` — Process crash (severity: 90)

## Go
- \`body.text:*panic:*\` — Go panic / unrecovered error (severity: 85)
- \`body.text:*runtime error*\` — Runtime crash (severity: 80)
- \`body.text:*context deadline exceeded*\` — Timeout (severity: 70)
- \`body.text:*connection refused*\` — Network failure (severity: 75)

## Databases
- \`body.text:*deadlock*\` — Database deadlock (severity: 75)
- \`body.text:*connection pool exhausted*\` — Pool exhaustion (severity: 80)
- \`body.text:*too many connections*\` — Connection limit (severity: 75)
- \`body.text:*slow query*\` — Performance degradation (severity: 55)
- \`body.text:*replication lag*\` — Replication delay (severity: 65)

## Kubernetes
- \`body.text:*CrashLoopBackOff*\` — Pod crash loop (severity: 80)
- \`body.text:*OOMKilled*\` — Container killed by OOM (severity: 85)
- \`body.text:*Evicted*\` — Pod evicted from node (severity: 70)
- \`body.text:*FailedScheduling*\` — Cannot schedule pod (severity: 75)
- \`body.text:*liveness probe failed*\` — Health check failure (severity: 70)

## HTTP / Web
- \`http.response.status_code >= 500\` — Server errors (severity: 70)
- \`body.text:*upstream timed out*\` — Reverse proxy timeout (severity: 75)
- \`body.text:*502 Bad Gateway*\` — Backend unreachable (severity: 75)
- \`body.text:*rate limit*\` — Rate limiting triggered (severity: 55)
`;

export const createQueryOptimizationSkill = (): SkillDefinition<typeof NAME, typeof BASE_PATH> => {
  return defineSkillType({
    id: ID,
    name: NAME,
    basePath: BASE_PATH,
    description:
      'Review significant event queries, validate against live data, identify monitoring gaps, and propose new queries for uncovered patterns.',
    content: SKILL_CONTENT,
    referencedContent: [
      {
        relativePath: '.',
        name: 'query-patterns',
        content: QUERY_PATTERNS_CONTENT,
      },
    ],
    getRegistryTools: () => [
      platformCoreTools.search,
      platformCoreTools.executeEsql,
      'streams.search_features',
      'streams.search_queries',
      'streams.semantic_correlate',
      STREAMS_SEARCH_INSIGHTS_TOOL_ID,
      STREAMS_WRITE_INSIGHT_TOOL_ID,
      STREAMS_SUGGEST_QUERY_TOOL_ID,
      STREAMS_ANNOTATE_FEATURE_TOOL_ID,
    ],
    getInlineTools: () => [],
  });
};
