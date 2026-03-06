/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';

export const generateDiscoveriesSkill = defineSkillType({
  id: 'streams.generate_discoveries',
  name: 'generate-discoveries',
  basePath: 'skills/streams',
  description:
    'Analyzes significant event data across streams to extract discoveries, enrich them with recommendations, and generate ES|QL query suggestions.',
  content: `# Generate Discoveries Skill

## Overview

Use this skill to help users analyze significant event data and generate actionable discoveries.
Follow the steps below to provide structured, valuable discoveries for SRE teams.

## Process

### 1. Search Existing Discoveries
- Use \`${internalNamespaces.streams}.search_discoveries\` to find relevant discoveries by query, stream, severity, or relevance score.
- Incorporate existing discoveries as context when generating new ones.

### 2. Fetch Discovery Details
- Use \`${internalNamespaces.streams}.get_discovery\` to retrieve full discovery details including evidence, references, and feedback when needed.

### 3. Run the Discovery Pipeline
- Use \`${internalNamespaces.streams}.run_discovery_pipeline\` to trigger the three-stage discovery pipeline on specified streams.
- This generates discoveries from significant event data.

### 4. Create Discoveries
- Use \`${internalNamespaces.streams}.create_discovery\` to persist new discoveries with title, description, severity, evidence, and references.
- Include actionable recommendations and ES|QL query suggestions when possible.

### 5. Query Entities
- Use \`${internalNamespaces.streams}.list_entities\` to fetch host, user, service, or generic entities from the Entity Store for additional context.

## Best Practices
- Start with searching existing discoveries to avoid duplicates and build on prior findings.
- Enrich discoveries with specific ES|QL query suggestions for SRE follow-up.
- Include severity and relevance scores to help prioritize findings.`,
  getRegistryTools: () => [
    `${internalNamespaces.streams}.search_discoveries`,
    `${internalNamespaces.streams}.get_discovery`,
    `${internalNamespaces.streams}.create_discovery`,
    `${internalNamespaces.streams}.run_discovery_pipeline`,
    `${internalNamespaces.streams}.list_entities`,
  ],
});
