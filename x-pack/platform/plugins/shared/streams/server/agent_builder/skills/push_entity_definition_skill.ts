/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { defineSkillType } from '@kbn/agent-builder-server/skills/type_definition';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';

export const pushEntityDefinitionSkill = defineSkillType({
  id: 'streams.push_entity_definition',
  name: 'push-entity-definition',
  basePath: 'skills/streams',
  description:
    'Maps discovered features to entity definitions and pushes them to the Entity Store.',
  content: `# Push Entity Definition Skill

## Overview

Use this skill to map discovered features from streams to entity definitions
and push them to the Security Entity Store.

## Process

### 1. Get Stream Features
- Use \`${internalNamespaces.streams}.get_stream_features\` to get discovered features.

### 2. Search Existing Discoveries
- Use \`${internalNamespaces.streams}.search_discoveries\` for additional entity context.

### 3. Check Existing Entities
- Use \`${internalNamespaces.streams}.list_entities\` to check if entities already exist.
- Avoid creating duplicates.

### 4. Push Entity Definitions
- Use \`${internalNamespaces.streams}.push_entity_definition\` to push entities.
- Classify entity types:
  - **host**: Machines, servers, VMs, containers, nodes (fields: host.name, host.ip, container.id)
  - **user**: People or service accounts (fields: user.name, user.email, user.id)
  - **service**: Applications, microservices, daemons (fields: service.name, service.version)
  - **generic**: Everything else (databases, network devices, clusters)

## Best Practices
- Always check for existing entities before pushing to avoid duplicates.
- Include relevant metadata from features (descriptions, filters, related fields).
- Map to specific types (host/user/service) when possible; use generic only as fallback.`,
  getRegistryTools: () => [
    `${internalNamespaces.streams}.get_stream_features`,
    `${internalNamespaces.streams}.search_discoveries`,
    `${internalNamespaces.streams}.push_entity_definition`,
    `${internalNamespaces.streams}.list_entities`,
  ],
});
