/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';

export const extractStreamFeaturesSkill = defineSkillType({
  id: 'streams.extract_stream_features',
  name: 'extract-stream-features',
  basePath: 'skills/streams',
  description:
    'Extracts features (systems, services, components) from stream data and persists them to the feature store.',
  content: `# Extract Stream Features Skill

## Overview

Use this skill to help users extract and manage features from stream data.
Features describe the systems, services, and components detected in log data.

## Process

### 1. Read Existing Features
- Use \`${internalNamespaces.streams}.get_stream_features\` to check what features already exist for the stream.
- Avoid duplicating existing features.

### 2. Analyze Stream Data
- Use \`platform.core.execute_esql\` to query the stream and identify patterns.
- Look for distinct values in fields like \`service.name\`, \`host.name\`, \`kubernetes.namespace\`, etc.

### 3. Write Features
- Use \`${internalNamespaces.streams}.upsert_features\` to persist discovered features.
- Each feature should have a descriptive name, description, and optional KQL filter.

## Best Practices
- Include KQL filters that identify events belonging to each feature.
- Use descriptive names that match the system or service being described.
- Check existing features first to avoid duplicates.`,
  getRegistryTools: () => [
    `${internalNamespaces.streams}.get_stream_features`,
    `${internalNamespaces.streams}.upsert_features`,
  ],
});
