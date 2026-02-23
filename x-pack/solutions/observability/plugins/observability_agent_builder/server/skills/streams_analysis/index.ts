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

const ID = 'streams_analysis';
const NAME = 'streams-analysis';
const BASE_PATH = 'skills/observability';

const SKILL_CONTENT = `# Streams Analysis

This skill provides a structured methodology for investigating incidents using Streams data,
correlating features with alerts, and generating actionable insights for SREs.

## When to use this skill

Use this skill when:
- Investigating an incident or anomaly detected in log streams
- Analyzing patterns across stream features and significant event queries
- Looking for correlations between different streams or services
- Building a record of investigation findings for future reference

## Available Tools

- **streams.search_features** — Find stream features (systems, services, infrastructure) by semantic search or filters
- **streams.search_queries** — Find significant event queries associated with streams
- **${STREAMS_SEARCH_INSIGHTS_TOOL_ID}** — Search previous investigation insights for historical context
- **${STREAMS_WRITE_INSIGHT_TOOL_ID}** — Persist investigation findings as structured insights (mandatory final step)
- **${platformCoreTools.search}** — Query raw data from Elasticsearch indices
- **${platformCoreTools.executeEsql}** — Run ES|QL queries for data analysis

## Investigation Methodology

Follow this structured approach for every investigation:

### 1. Context Gathering
- Use \`streams.search_features\` to understand what systems and components exist in the affected streams
- Use \`streams.search_queries\` to find relevant significant event queries
- Use \`${STREAMS_SEARCH_INSIGHTS_TOOL_ID}\` to check if similar issues have been investigated before

### 2. Alert Correlation
- Cross-reference current alerts with stream features using semantic search
- Identify which features are associated with the alerting patterns
- Look for temporal correlations between different alert types

### 3. Root Cause Investigation
- Use \`${platformCoreTools.executeEsql}\` to query raw log data for evidence
- Compare time windows (before/during incident) to identify changes
- Look for error patterns, rate changes, and anomalous field values
- Use \`${platformCoreTools.search}\` for targeted document retrieval

### 4. Insight Synthesis
- Summarize findings into a structured insight with:
  - Clear title describing the finding
  - Detailed description of what was observed
  - Impact assessment (critical/high/medium/low)
  - Category (anomaly/trend/correlation/error_spike/performance/capacity/other)
  - Evidence linking to specific queries and features
  - Actionable recommendations
- **Always call \`${STREAMS_WRITE_INSIGHT_TOOL_ID}\`** to persist the insight — this is mandatory

### 5. Recommendations
- Suggest new significant event queries for future detection
- Identify gaps in monitoring coverage
- Recommend feature enrichment or annotation

## Constraints

- Base all conclusions on actual queried data, not assumptions
- Include confidence scores that reflect the strength of evidence
- Always persist findings using \`${STREAMS_WRITE_INSIGHT_TOOL_ID}\` — do not skip this step
- Keep query result sets small enough to fit within context limits
- Reference specific stream names, feature IDs, and query titles in evidence
`;

const PLAYBOOK_CONTENT = `# Investigation Playbook

## Quick Triage Checklist

1. **What streams are affected?** — Identify the scope
2. **What features exist?** — Search features for the affected streams
3. **What queries are firing?** — Check significant event queries
4. **Has this happened before?** — Search historical insights
5. **What changed?** — Compare before/after time windows
6. **What is the root cause?** — Correlate evidence
7. **What should we do?** — Write recommendations
8. **Record findings** — Persist the insight

## Common Investigation Patterns

### Error Spike Investigation
1. Search features for the affected stream
2. Query log data for error patterns using ES|QL
3. Compare error rates before and during the spike
4. Identify which services/components are affected
5. Record insight with category "error_spike"

### Performance Degradation
1. Search features for service-related components
2. Query metrics for latency and throughput changes
3. Look for correlated infrastructure changes
4. Check for deployment events in the time window
5. Record insight with category "performance"

### Anomaly Investigation
1. Search insights for similar past anomalies
2. Query raw data to characterize the anomaly
3. Search features for potentially related systems
4. Assess impact based on affected scope
5. Record insight with category "anomaly"
`;

export const createStreamsAnalysisSkill = (): SkillDefinition<
  typeof NAME,
  typeof BASE_PATH
> => {
  return defineSkillType({
    id: ID,
    name: NAME,
    basePath: BASE_PATH,
    description:
      'Analyze Streams data to investigate incidents, identify patterns, correlate features with alerts, and generate actionable insights for SREs.',
    content: SKILL_CONTENT,
    referencedContent: [
      {
        relativePath: '.',
        name: 'investigation-playbook',
        content: PLAYBOOK_CONTENT,
      },
    ],
    getRegistryTools: () => [
      platformCoreTools.search,
      platformCoreTools.executeEsql,
      'streams.search_features',
      'streams.search_queries',
      STREAMS_SEARCH_INSIGHTS_TOOL_ID,
      STREAMS_WRITE_INSIGHT_TOOL_ID,
    ],
    getInlineTools: () => [],
  });
};
