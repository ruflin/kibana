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

const getStreamFeaturesSchema = z.object({
  streamName: z.string().describe('The name of the stream to get features for'),
});

export const GET_STREAM_FEATURES_TOOL_ID = `${internalNamespaces.streams}.get_stream_features`;

export const createGetStreamFeaturesTool = ({
  deps,
}: {
  deps: StreamsToolsDependencies;
}): StaticToolRegistration<typeof getStreamFeaturesSchema> => {
  const toolDefinition: BuiltinToolDefinition<typeof getStreamFeaturesSchema> = {
    id: GET_STREAM_FEATURES_TOOL_ID,
    type: ToolType.builtin,
    description: `Read features extracted from a stream. Features describe systems, services, and components detected in the stream data.

When to use:
- Understanding what systems and services are present in a stream
- Getting context before generating sig events queries
- Enriching discoveries with feature information`,
    schema: getStreamFeaturesSchema,
    tags: ['streams', 'features'],
    handler: async (toolParams, { request }) => {
      try {
        const { FeatureService } = await import('../../lib/streams/feature/feature_service');
        const featureService = new FeatureService(deps.core, deps.logger);
        const featureClient = await featureService.getClientWithRequest({ request });
        const features = await featureClient.getAssets(toolParams.streamName);

        return {
          results: [
            {
              type: ToolResultType.other,
              data: { streamName: toolParams.streamName, features },
            },
          ],
        };
      } catch (error) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to get stream features: ${error.message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
};
