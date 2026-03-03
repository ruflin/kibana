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

        let features;
        try {
          const result = await featureClient.getFeatures(toolParams.streamName);
          features = result.hits;
        } catch (fetchError) {
          // getFeatures may fail if stored documents are missing required fields.
          // Fall back to raw ES search and filter to valid features.
          const esClient = (await deps.getEsClient(request)).asCurrentUser;
          const response = await esClient.search({
            index: '.kibana_streams_features',
            size: 10_000,
            query: { bool: { filter: [{ term: { 'stream.name': toolParams.streamName } }] } },
          });

          features = response.hits.hits
            .map((hit) => {
              const src = hit._source as Record<string, unknown> | undefined;
              if (!src) return null;
              const feature = src.feature as Record<string, unknown> | undefined;
              if (!feature) return null;
              return {
                uuid: feature.uuid ?? hit._id,
                id: feature.id ?? feature.uuid ?? hit._id,
                stream_name: (src.stream as Record<string, unknown>)?.name ?? toolParams.streamName,
                type: feature.type ?? 'unknown',
                subtype: feature.subtype,
                title: feature.title,
                description: feature.description ?? '',
                properties: feature.properties ?? {},
                confidence: feature.confidence ?? 0,
                evidence: feature.evidence,
                status: feature.status ?? 'active',
                last_seen: feature.last_seen ?? new Date().toISOString(),
                tags: feature.tags,
                meta: feature.meta,
                expires_at: feature.expires_at,
              };
            })
            .filter((f): f is NonNullable<typeof f> => f !== null);
        }

        const validFeatures = features.filter(
          (f) => typeof f.id === 'string' && typeof f.type === 'string'
        );

        return {
          results: [
            {
              type: ToolResultType.other,
              data: {
                streamName: toolParams.streamName,
                features: validFeatures,
                total: validFeatures.length,
              },
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
