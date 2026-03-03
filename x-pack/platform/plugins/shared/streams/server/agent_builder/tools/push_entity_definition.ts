/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type { BuiltinToolDefinition, StaticToolRegistration } from '@kbn/agent-builder-server';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import { EntityStoreClient } from '../../lib/entity_store/entity_store_client';
import type { StreamsToolsDependencies } from './types';

const pushEntityDefinitionSchema = z.object({
  entities: z
    .array(
      z.object({
        type: z
          .enum(['host', 'user', 'service', 'generic'])
          .describe('Entity type. Use generic for anything that does not fit host/user/service.'),
        name: z.string().describe('Entity name (e.g., hostname, username, service name)'),
        metadata: z
          .record(z.unknown())
          .optional()
          .describe('Additional metadata to store with the entity'),
      })
    )
    .describe('Entities to push to the Entity Store'),
});

export const PUSH_ENTITY_DEFINITION_TOOL_ID = `${internalNamespaces.streams}.push_entity_definition`;

export const createPushEntityDefinitionTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof pushEntityDefinitionSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof pushEntityDefinitionSchema> = {
    id: PUSH_ENTITY_DEFINITION_TOOL_ID,
    type: ToolType.builtin,
    description: `Push entity definitions to the Entity Store. Maps discovered features to entity definitions (host, user, service, or generic).

When to use:
- Persisting discovered entities from stream features
- Mapping discovered hosts, users, or services to the Entity Store
- Creating entity definitions for cross-referencing`,
    schema: pushEntityDefinitionSchema,
    tags: ['streams', 'entities'],
    handler: async (toolParams, { esClient }) => {
      try {
        const entityClient = new EntityStoreClient(esClient.asCurrentUser, deps.logger);

        const results = await Promise.all(
          toolParams.entities.map((entity) => entityClient.pushEntityDefinition(entity))
        );

        const successCount = results.filter((r) => r.acknowledged).length;

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                message: `Pushed ${successCount}/${toolParams.entities.length} entities to the Entity Store`,
                results,
              },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to push entity definitions: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
