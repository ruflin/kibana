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
import type { StreamsToolsDependencies } from './types';

const getDiscoverySchema = z.object({
  uuid: z.string().describe('The UUID of the discovery to retrieve'),
});

export const GET_DISCOVERY_TOOL_ID = `${internalNamespaces.streams}.get_discovery`;

export const createGetDiscoveryTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof getDiscoverySchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof getDiscoverySchema> = {
    id: GET_DISCOVERY_TOOL_ID,
    type: ToolType.builtin,
    description: `Fetch a single discovery by UUID, including full evidence, cross-references, recommendations, and feedback.

When to use:
- Getting the full details of a specific discovery
- Reviewing evidence and recommendations for a discovery
- Checking feedback status on a discovery`,
    schema: getDiscoverySchema,
    tags: ['streams', 'discoveries'],
    handler: async (toolParams, { request }) => {
      try {
        const discoveryClient = await deps.getDiscoveryClient(request);
        const discovery = await discoveryClient.getDiscovery(toolParams.uuid);

        if (!discovery) {
          return {
            results: [
              {
                type: ToolResultType.error,
                data: { message: `Discovery ${toolParams.uuid} not found` },
              },
            ],
          };
        }

        return {
          results: [{ type: ToolResultType.other, data: { discovery } }],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to get discovery: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
