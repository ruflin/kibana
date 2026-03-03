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

const listEntitiesSchema = z.object({
  type: z.enum(['host', 'user', 'service', 'generic']).optional().describe('Filter by entity type'),
  size: z.number().optional().default(50).describe('Maximum number of entities to return'),
});

export const LIST_ENTITIES_TOOL_ID = `${internalNamespaces.streams}.list_entities`;

export const createListEntitiesTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof listEntitiesSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof listEntitiesSchema> = {
    id: LIST_ENTITIES_TOOL_ID,
    type: ToolType.builtin,
    description: `Search and list entities from the Entity Store (hosts, users, services, generic entities).

When to use:
- Checking if an entity already exists before pushing a new one
- Enriching discoveries with entity context
- Cross-referencing discovered features with known entities
- Getting entity metadata for investigation`,
    schema: listEntitiesSchema,
    tags: ['streams', 'entities'],
    handler: async (toolParams, { esClient }) => {
      try {
        const entityClient = new EntityStoreClient(esClient.asCurrentUser, deps.logger);
        const entities = await entityClient.listEntities({
          type: toolParams.type,
          size: toolParams.size,
        });

        return {
          results: [
            {
              type: ToolResultType.other,
              data: { total: entities.length, entities },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to list entities: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
