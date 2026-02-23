/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { SkillDefinition } from '@kbn/agent-builder-server/skills';
import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { platformCoreTools } from '@kbn/agent-builder-common';
import { STREAMS_ANNOTATE_FEATURE_TOOL_ID } from '../../tools/streams/annotate_feature/tool';

const ID = 'feature_refinement';
const NAME = 'feature-refinement';
const BASE_PATH = 'skills/observability';

const SKILL_CONTENT = `# Feature Refinement

This skill validates, deduplicates, and enriches stream features that were identified by the
automated feature identification task. Features are the foundation of the Streams knowledge
graph — higher-quality features lead to better significant event queries and more accurate
insights.

## When to use this skill

Use this skill when:
- Reviewing features after the automated identification task runs
- A user asks to validate or improve features for a stream
- Investigating reveals that features are incomplete, duplicated, or inaccurate
- Merging features from related streams that describe the same components

## Methodology

### 1. Inventory existing features
- Use \`streams.search_features\` with the target stream name to get all current features
- Group features by type (entity, infrastructure, technology, dependency, schema)
- Note features with low confidence (< 70) — these are candidates for validation or removal

### 2. Validate against live data
- For each entity feature, use \`${platformCoreTools.executeEsql}\` to verify the identifying
  fields actually exist in the data:
  \`FROM logs-generic-default | WHERE service.name == "order-service" | LIMIT 1\`
- For dependency features, verify both source and target exist in the data
- For technology features, verify version strings and library names against log evidence
- For schema features, verify field naming conventions match the claimed schema family

### 3. Check for duplicates and conflicts
- Use \`streams.semantic_correlate\` with each feature's description to find semantically
  similar features across streams — these may be duplicates or related components
- Look for features with overlapping \`properties\` that should be merged
- Identify features that contradict each other (e.g., conflicting version numbers)

### 4. Enrich with cross-stream context
- Use \`streams.search_features\` across all streams (no stream filter) to find features
  that describe the same component in different streams
- Use \`${platformCoreTools.integrationKnowledge}\` to find known integration patterns
  that could add context to technology and infrastructure features
- Check \`streams.search_insights\` for investigation findings that mention specific features

### 5. Apply refinements
- Use \`${STREAMS_ANNOTATE_FEATURE_TOOL_ID}\` to:
  - Add validation notes ("Verified: service.name field confirmed in live data")
  - Adjust confidence scores based on validation results
  - Add tags for categorization ("validated", "needs-review", "cross-stream")
  - Add incident context from insights that reference the feature

## Quality criteria for features

### Entity features
- Must have a verifiable identifying field (e.g., \`service.name\`, \`host.name\`)
- Description should explain the component's role in the system
- Properties must include at least \`name\` and ideally \`technology\`
- Confidence >= 70 requires explicit field evidence; < 70 requires "inferred" tag

### Dependency features
- Both source and target must exist as entity features (or be verifiable in data)
- Protocol should be specified (http, grpc, postgresql, etc.)
- Evidence should include actual log lines showing the interaction

### Technology features
- Version should be normalized (numeric only in properties, raw in meta)
- Library/framework name should match official naming
- Evidence should include specific log patterns or field values

### Infrastructure features
- Cloud provider should be verified against \`cloud.provider\` field
- Container orchestration should be verified against \`container.*\` or \`kubernetes.*\` fields

## Constraints

- Never delete features — only annotate with validation results
- Preserve original confidence scores in annotations when adjusting
- Tag all agent-refined features with "agent-refined" for traceability
- Base all validation on queried data, not assumptions
- Report a summary of changes made at the end
`;

const VALIDATION_CHECKLIST_CONTENT = `# Feature Validation Checklist

## Per-feature checks

| Check | How to verify | Action if failed |
|-------|--------------|------------------|
| Identifying field exists | ES|QL query for the field value | Lower confidence, add "unverified" tag |
| No duplicate in same stream | Search features with same type + properties | Annotate both with cross-reference |
| No duplicate across streams | semantic_correlate with description | Annotate with "cross-stream-duplicate" tag |
| Evidence is current | ES|QL query matching evidence strings | Update evidence via annotation |
| Version is normalized | Check properties.version format | Annotate with corrected version |
| Description is accurate | Compare description to actual data | Annotate with corrected description |

## Stream-level checks

| Check | How to verify | Action if failed |
|-------|--------------|------------------|
| All services have entity features | ES|QL STATS by service.name | Note missing entities in summary |
| Dependencies match entity pairs | Cross-reference dependency source/target with entities | Annotate orphaned dependencies |
| Schema feature matches actual fields | ES|QL KEEP + field inspection | Annotate schema feature |
| No conflicting technology versions | Compare version properties across features | Annotate conflicts |

## Confidence adjustment rules

| Scenario | Adjustment |
|----------|-----------|
| Field verified in live data | Set to max(current, 85) |
| Field not found in data | Set to min(current, 40), add "unverified" |
| Duplicate found, evidence stronger | Keep higher-confidence version, lower the other |
| Cross-stream corroboration | Increase by 10 (cap at 95) |
| Contradicted by newer data | Decrease by 20 (floor at 20) |
`;

export const createFeatureRefinementSkill = (): SkillDefinition<typeof NAME, typeof BASE_PATH> => {
  return defineSkillType({
    id: ID,
    name: NAME,
    basePath: BASE_PATH,
    description:
      'Validate, deduplicate, and enrich stream features using live data queries and cross-stream correlation.',
    content: SKILL_CONTENT,
    referencedContent: [
      {
        relativePath: '.',
        name: 'validation-checklist',
        content: VALIDATION_CHECKLIST_CONTENT,
      },
    ],
    getRegistryTools: () => [
      platformCoreTools.search,
      platformCoreTools.executeEsql,
      platformCoreTools.integrationKnowledge,
      'streams.search_features',
      'streams.search_queries',
      'streams.search_insights',
      'streams.semantic_correlate',
      STREAMS_ANNOTATE_FEATURE_TOOL_ID,
    ],
    getInlineTools: () => [],
  });
};
