/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type { BuiltinToolDefinition } from '@kbn/agent-builder-server';
import { v4 as uuid, v5 as uuidv5 } from 'uuid';
import { identifyFeatures, generateAllComputedFeatures } from '@kbn/streams-ai';
import { getSampleDocuments } from '@kbn/ai-tools/src/tools/describe_dataset/get_sample_documents';
import { isComputedFeature } from '@kbn/streams-schema';
import type { BaseFeature } from '@kbn/streams-schema';
import type { GetScopedClients } from '../../../routes/types';
import type { StreamsServer } from '../../../types';
import { getErrorMessage } from '../../streams/errors/parse_error';
import { assertSignificantEventsAccess } from '../../../routes/utils/assert_significant_events_access';
import { resolveConnectorId } from '../../../routes/utils/resolve_connector_id';
import { PromptsConfigService } from '../../saved_objects/significant_events/prompts_config_service';
import { MAX_FEATURE_AGE_MS } from '../../streams/feature/feature_client';

export const EXTRACT_FEATURES_TOOL_ID = 'streams.extract_features';

const DEFAULT_TIME_RANGE_HOURS = 24;

const extractFeaturesSchema = z.object({
  streamName: z.string().describe('The name of the stream to extract features from.'),
  from: z
    .string()
    .optional()
    .describe(
      'Start of the time range as an ISO 8601 date string (e.g. "2024-01-01T00:00:00Z"). Defaults to 24 hours ago.'
    ),
  to: z
    .string()
    .optional()
    .describe(
      'End of the time range as an ISO 8601 date string (e.g. "2024-01-02T00:00:00Z"). Defaults to now.'
    ),
  connectorId: z
    .string()
    .optional()
    .describe(
      'The AI connector ID to use for feature identification. Defaults to the configured default AI connector.'
    ),
});

export const createExtractFeaturesTool = ({
  getScopedClients,
  server,
}: {
  getScopedClients: GetScopedClients;
  server: StreamsServer;
}): BuiltinToolDefinition<typeof extractFeaturesSchema> => {
  return {
    id: EXTRACT_FEATURES_TOOL_ID,
    type: ToolType.builtin,
    description: `Extract and persist features from a stream's data using AI analysis. Results are saved to the streams feature store (backend storage for the Streams app) only. NEVER call attachment_add or attachment_update to store this tool's result — persistence is already complete.

Features represent characteristics of the data in a stream, such as systems, components, log patterns, error types, and dataset statistics.

Use this tool when the user asks to:
- Extract features from a stream
- Identify features in a stream
- Analyze a stream for features
- Refresh or update features for a stream

The tool runs the full feature identification pipeline (AI-based inference + computed statistics) and persists the results to the feature store so they are available in the Streams app.`,
    schema: extractFeaturesSchema,
    tags: [],
    handler: async (
      { streamName, from, to, connectorId: connectorIdParam },
      { request, logger }
    ) => {
      const {
        featureClient,
        streamsClient,
        inferenceClient,
        licensing,
        uiSettingsClient,
        scopedClusterClient,
        soClient,
      } = await getScopedClients({ request });

      try {
        await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });
      } catch (err) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: {
                message: `Cannot extract features: ${getErrorMessage(err)}`,
              },
            },
          ],
        };
      }

      let stream;
      try {
        stream = await streamsClient.getStream(streamName);
      } catch (err) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: {
                message: `Stream "${streamName}" not found: ${getErrorMessage(err)}`,
              },
            },
          ],
        };
      }

      let resolvedConnectorId: string;
      try {
        resolvedConnectorId = await resolveConnectorId({
          connectorId: connectorIdParam,
          uiSettingsClient,
          logger,
        });
      } catch (err) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: {
                message: `Cannot resolve AI connector: ${getErrorMessage(err)}`,
              },
            },
          ],
        };
      }

      const now = Date.now();
      const end = to ? new Date(to).getTime() : now;
      const start = from ? new Date(from).getTime() : now - DEFAULT_TIME_RANGE_HOURS * 60 * 60 * 1000;

      const { featurePromptOverride } = await new PromptsConfigService({
        soClient,
        logger,
      }).getPrompt();

      const boundInferenceClient = inferenceClient.bindTo({ connectorId: resolvedConnectorId });
      const esClient = scopedClusterClient.asCurrentUser;

      const { hits: sampleDocuments } = await getSampleDocuments({
        esClient,
        index: stream.name,
        start,
        end,
        size: 20,
      });

      const [{ features: inferredBaseFeatures }, computedFeatures] = await Promise.all([
        identifyFeatures({
          streamName: stream.name,
          sampleDocuments,
          inferenceClient: boundInferenceClient,
          logger: logger.get('identify_features'),
          signal: new AbortController().signal,
          systemPrompt: featurePromptOverride,
        }),
        generateAllComputedFeatures({
          stream,
          start,
          end,
          esClient,
          logger: logger.get('computed_features'),
        }),
      ]);

      const identifiedFeatures: BaseFeature[] = [...inferredBaseFeatures, ...computedFeatures];

      const { hits: existingFeatures } = await featureClient.getFeatures(stream.name);
      const nowMs = Date.now();
      const features = identifiedFeatures.map((feature) => {
        const existing = featureClient.findDuplicateFeature({ existingFeatures, feature });
        return {
          ...feature,
          status: 'active' as const,
          last_seen: new Date(nowMs).toISOString(),
          expires_at: new Date(nowMs + MAX_FEATURE_AGE_MS).toISOString(),
          uuid: isComputedFeature(feature)
            ? uuidv5(`${streamName}:${feature.id}`, uuidv5.DNS)
            : existing?.uuid ?? uuid(),
        };
      });

      await featureClient.bulk(
        stream.name,
        features.map((feature) => ({ index: { feature } }))
      );

      return {
        results: [
          {
            type: ToolResultType.other,
            data: {
              streamName: stream.name,
              featuresExtracted: features.length,
              features: features.map((f) => ({
                id: f.id,
                type: f.type,
                title: f.title,
                description: f.description,
              })),
              _note: 'Features are persisted to the stream feature store only. Do not call attachment_add or attachment_update for this result.',
            },
          },
        ],
      };
    },
  };
};
