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

const upsertFeaturesSchema = z.object({
  streamName: z.string().describe('The name of the stream to write features for'),
  features: z
    .array(
      z.object({
        name: z.string().describe('Feature name (e.g., "nginx", "kubernetes")'),
        description: z.string().describe('Description of the feature'),
        filter: z
          .string()
          .optional()
          .describe('KQL filter that identifies events for this feature'),
      })
    )
    .describe('Features to upsert'),
});

export const UPSERT_FEATURES_TOOL_ID = `${internalNamespaces.streams}.upsert_features`;

export const createUpsertFeaturesTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof upsertFeaturesSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof upsertFeaturesSchema> = {
    id: UPSERT_FEATURES_TOOL_ID,
    type: ToolType.builtin,
    description: `Write features to the feature store for a stream. Features describe systems, services, and components detected in the data.

When to use:
- Persisting newly extracted features for a stream
- Updating existing feature descriptions or filters`,
    schema: upsertFeaturesSchema,
    tags: ['streams', 'features'],
    handler: async (toolParams, { request }) => {
      try {
        const { FeatureService } = await import('../../lib/streams/feature/feature_service');
        const featureService = new FeatureService(deps.core, deps.logger);
        const featureClient = await featureService.getClientWithRequest({ request });

        await featureClient.bulk({
          streamName: toolParams.streamName,
          operations: toolParams.features.map((f) => ({
            index: {
              feature: {
                name: f.name,
                description: f.description,
                filter: f.filter,
              },
            },
          })),
        });

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                message: `Upserted ${toolParams.features.length} features for stream ${toolParams.streamName}`,
              },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to upsert features: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
