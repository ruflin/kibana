/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { v4 as uuidv4 } from 'uuid';
import { z } from '@kbn/zod';
import { ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type { BuiltinToolDefinition, StaticToolRegistration } from '@kbn/agent-builder-server';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type { Feature } from '@kbn/streams-schema';
import type { StreamsToolsDependencies } from './types';

const upsertFeaturesSchema = z.object({
  streamName: z.string().describe('The name of the stream to write features for'),
  features: z
    .array(
      z.object({
        name: z
          .string()
          .describe(
            'Feature identifier (e.g., "nginx", "kubernetes", "payment_service"). Used as the feature ID.'
          ),
        type: z
          .string()
          .optional()
          .describe(
            'Feature type category (e.g., "service", "system", "component", "integration"). Defaults to "user_defined".'
          ),
        subtype: z
          .string()
          .optional()
          .describe(
            'Feature subtype for more specific categorization (e.g., "web_server", "container_orchestrator")'
          ),
        description: z.string().describe('Description of the feature'),
        confidence: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe('Confidence score 0-100. Defaults to 80.'),
        filter: z
          .string()
          .optional()
          .describe('KQL filter that identifies events for this feature'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Tags for categorization (e.g., ["infrastructure", "web"])'),
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

        const now = new Date().toISOString();
        const features: Feature[] = toolParams.features.map((f) => ({
          id: f.name,
          uuid: uuidv4(),
          stream_name: toolParams.streamName,
          type: f.type ?? 'user_defined',
          subtype: f.subtype,
          title: f.name,
          description: f.description,
          properties: f.filter ? { filter: f.filter } : {},
          confidence: f.confidence ?? 80,
          tags: f.tags,
          status: 'active' as const,
          last_seen: now,
        }));

        await featureClient.bulk(
          toolParams.streamName,
          features.map((feature) => ({ index: { feature } }))
        );

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                message: `Upserted ${toolParams.features.length} features for stream ${toolParams.streamName}`,
                features: features.map((f) => ({
                  id: f.id,
                  type: f.type,
                  uuid: f.uuid,
                })),
              },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: {
                message: `Failed to upsert features: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
