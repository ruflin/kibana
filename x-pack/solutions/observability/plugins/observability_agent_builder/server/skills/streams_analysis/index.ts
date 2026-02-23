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
import { STREAMS_ANNOTATE_FEATURE_TOOL_ID } from '../../tools/streams/annotate_feature/tool';

const ID = 'streams_analysis';
const NAME = 'streams-analysis';
const BASE_PATH = 'skills/observability';

const SKILL_CONTENT = `# Streams Analysis

This skill provides a structured methodology for investigating incidents using Streams data,
correlating features with alerts, and generating actionable insights for SREs. It implements
the full feedback loop: investigate, record findings, suggest detectors, and enrich features.

## When to use this skill

Use this skill when:
- Investigating an incident or anomaly detected in log streams
- Analyzing patterns across stream features and significant event queries
- Looking for correlations between different streams or services
- Building a record of investigation findings for future reference
- Proposing new significant event queries based on discovered patterns
- Enriching features with investigation context

## Available Tools

### Semantic search tools (primary — use these first)
- **streams.search_features** — Find stream features by semantic similarity or filters. Uses RRF over semantic_text fields — far more powerful than text grep. Always prefer this over loading all features.
- **streams.search_queries** — Find significant event queries by semantic similarity or filters. Same RRF-based semantic search.
- **${STREAMS_SEARCH_INSIGHTS_TOOL_ID}** — Search previous investigation insights for historical context. Semantic search over title, description, and recommendations.
- **streams.semantic_correlate** — Find features (and optionally queries) semantically related to a natural-language query. Use for correlating alerts with identified systems.

### Data query tools
- **${platformCoreTools.search}** — Query raw data from Elasticsearch indices
- **${platformCoreTools.executeEsql}** — Run ES|QL queries for data analysis

### Context loading tools (use sparingly)
- **streams.load_stream_context** — Load ALL features and queries for a stream into the filestore at /streams/{stream}.json. Use ONLY when you need a comprehensive overview of a stream and plan to reference it multiple times. Prefer semantic search tools for targeted retrieval.

### Write tools (feedback loop)
- **${STREAMS_WRITE_INSIGHT_TOOL_ID}** — Persist investigation findings as structured insights (mandatory final step)
- **${STREAMS_SUGGEST_QUERY_TOOL_ID}** — Propose a new significant event query for future detection
- **${STREAMS_ANNOTATE_FEATURE_TOOL_ID}** — Enrich a feature with investigation notes, tags, or confidence adjustments

## Tool Selection Strategy

**Always prefer semantic search over bulk loading.** The search tools use Elasticsearch semantic_text
fields with RRF (Reciprocal Rank Fusion), which finds relevant results by meaning — not just text
matching. This is more token-efficient and more accurate than loading everything into the filestore
and grepping through it.

**When to use which tool:**
- "What features relate to payment errors?" → \`streams.search_features\` with query parameter
- "What queries detect timeout issues?" → \`streams.search_queries\` with query parameter
- "Has this been investigated before?" → \`${STREAMS_SEARCH_INSIGHTS_TOOL_ID}\` with query parameter
- "What features correlate with this alert?" → \`streams.semantic_correlate\` with the alert name
- "Give me everything about this stream" → \`streams.load_stream_context\` (only for comprehensive overview)

**Filestore behavior:** All tool results are automatically cached in the filestore under
/tool_calls/. Large results (>500 tokens) are replaced with file references in conversation
history — use \`filestore.read\` to access them again. You do NOT need to manually save results;
the system handles this automatically.

## Investigation Methodology

Follow this structured approach for every investigation:

### 1. Context Gathering (use semantic search)
- Use \`${STREAMS_SEARCH_INSIGHTS_TOOL_ID}\` FIRST to check if similar issues have been investigated before
- Use \`streams.search_features\` with a semantic query describing the problem to find relevant systems
- Use \`streams.search_queries\` to find significant event queries related to the symptoms
- Use \`streams.semantic_correlate\` to find features that correlate with specific alert names

### 2. Alert Correlation
- Cross-reference current alerts with stream features using \`streams.semantic_correlate\`
- Identify which features are associated with the alerting patterns
- Look for temporal correlations between different alert types

### 3. Root Cause Investigation
- Use \`${platformCoreTools.executeEsql}\` to query raw log data for evidence
- Compare time windows (before/during incident) to identify changes
- Look for error patterns, rate changes, and anomalous field values
- Use \`${platformCoreTools.search}\` for targeted document retrieval
- If you need to reference features/queries repeatedly, use \`streams.load_stream_context\` to cache them in the filestore, then use \`filestore.read\` for subsequent access

### 4. Insight Synthesis
- Summarize findings into a structured insight with:
  - Clear title describing the finding
  - Detailed description of what was observed
  - Impact assessment (critical/high/medium/low)
  - Category (anomaly/trend/correlation/error_spike/performance/capacity/other)
  - Evidence linking to specific queries and features
  - Actionable recommendations
- **Always call \`${STREAMS_WRITE_INSIGHT_TOOL_ID}\`** to persist the insight — this is mandatory

### 5. Feedback Loop Actions
After recording the insight, take these additional actions when appropriate:

- **Suggest queries:** If you discovered a recurring pattern that is NOT already covered by an
  existing significant event query, call \`${STREAMS_SUGGEST_QUERY_TOOL_ID}\` to propose a KQL
  query that would detect it in the future. Include evidence explaining why the query is valuable.

- **Annotate features:** If investigation revealed new context about a feature (e.g. it was
  involved in the incident, its confidence should be adjusted, or it needs tagging), call
  \`${STREAMS_ANNOTATE_FEATURE_TOOL_ID}\` to enrich it. Annotations are additive and preserve
  existing data.

## Constraints

- Base all conclusions on actual queried data, not assumptions
- Include confidence scores that reflect the strength of evidence
- Always persist findings using \`${STREAMS_WRITE_INSIGHT_TOOL_ID}\` — do not skip this step
- Prefer semantic search tools over load_stream_context for targeted retrieval
- Suggest queries only when the pattern is NOT already covered by existing queries
- Annotate features only when investigation provides genuinely new context
- Keep query result sets small enough to fit within context limits
- Reference specific stream names, feature IDs, and query titles in evidence
`;

const PLAYBOOK_CONTENT = `# Investigation Playbook

## Quick Triage Checklist

1. **Has this happened before?** — Search insights FIRST (cheapest, most valuable)
2. **What streams are affected?** — Identify the scope
3. **What features correlate?** — Use semantic_correlate with the alert/symptom description
4. **What queries are firing?** — Search queries for the affected streams
5. **What changed?** — Compare before/after time windows with ES|QL
6. **What is the root cause?** — Correlate evidence across data sources
7. **What should we do?** — Write recommendations
8. **Record findings** — Persist the insight (mandatory)
9. **Suggest detectors** — Propose queries for patterns not yet monitored
10. **Enrich features** — Annotate features with investigation context

## Tool Priority Order

For every investigation, follow this tool priority:

1. **\`${STREAMS_SEARCH_INSIGHTS_TOOL_ID}\`** — Check history first. If this issue was investigated
   before, you save significant effort. Always start here.
2. **\`streams.semantic_correlate\`** — Correlate the alert/symptom with known features. This uses
   semantic search to find related systems without needing exact field values.
3. **\`streams.search_features\`** / **\`streams.search_queries\`** — Targeted semantic search
   when you know what you're looking for (specific stream, type, severity).
4. **\`${platformCoreTools.executeEsql}\`** / **\`${platformCoreTools.search}\`** — Query raw data
   for evidence once you know where to look.
5. **\`streams.load_stream_context\`** — Only when you need the FULL picture of a stream and plan
   to reference features/queries multiple times. The data is cached in the filestore at
   /streams/{stream}.json for repeated access via filestore.read.

## Common Investigation Patterns

### Error Spike Investigation
1. Search insights for similar past error spikes
2. Use semantic_correlate with the error description to find related features
3. Query log data for error patterns using ES|QL
4. Compare error rates before and during the spike
5. Identify which services/components are affected
6. Record insight with category "error_spike"
7. Suggest a KQL query to detect this error pattern in the future
8. Annotate affected features with incident context

### Performance Degradation
1. Search insights for similar past performance issues
2. Use semantic_correlate to find service-related features
3. Query metrics for latency and throughput changes
4. Look for correlated infrastructure changes
5. Check for deployment events in the time window
6. Record insight with category "performance"
7. Suggest a query to detect the latency threshold breach
8. Annotate service features with performance findings

### Anomaly Investigation
1. Search insights for similar past anomalies
2. Use semantic_correlate to find potentially related systems
3. Query raw data to characterize the anomaly
4. Assess impact based on affected scope
5. Record insight with category "anomaly"
6. If the anomaly is recurring, suggest a detection query
7. Annotate features involved in the anomaly

## Feedback Loop Decision Guide

### When to suggest a query
- The pattern is NOT already covered by an existing significant event query
- The pattern has appeared multiple times or is likely to recur
- A KQL expression can reasonably capture the pattern
- The severity warrants automated detection

### When to annotate a feature
- Investigation revealed the feature was directly involved in an incident
- The feature's confidence score needs adjustment based on observed behavior
- Tags would help future investigations (e.g. "incident-prone", "investigated-2026-02")
- New context about the feature was discovered that isn't in its description

### When to use load_stream_context
- You need a comprehensive overview of ALL features and queries for a stream
- You plan to reference the data multiple times during the investigation
- The stream has a manageable number of features (< 50)
- Do NOT use it as a substitute for semantic search — search tools are more targeted and token-efficient
`;

export const createStreamsAnalysisSkill = (): SkillDefinition<typeof NAME, typeof BASE_PATH> => {
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
      'streams.semantic_correlate',
      'streams.load_stream_context',
      STREAMS_SEARCH_INSIGHTS_TOOL_ID,
      STREAMS_WRITE_INSIGHT_TOOL_ID,
      STREAMS_SUGGEST_QUERY_TOOL_ID,
      STREAMS_ANNOTATE_FEATURE_TOOL_ID,
    ],
    getInlineTools: () => [],
  });
};
