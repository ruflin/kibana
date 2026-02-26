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
import { v4 as uuid } from 'uuid';
import type { GetScopedClients } from '../../../routes/types';
import type { StreamsServer } from '../../../types';
import { getErrorMessage } from '../../streams/errors/parse_error';
import { assertSignificantEventsAccess } from '../../../routes/utils/assert_significant_events_access';
import { MAX_FEATURE_AGE_MS } from '../../streams/feature/feature_client';

export const UPSERT_FEATURES_TOOL_ID = 'streams.upsert_features';

const featureInputSchema = z.object({
  id: z
    .string()
    .describe(
      'Unique identifier for the feature within the stream (e.g. "nginx-access-logs", "payment-service").'
    ),
  type: z
    .string()
    .describe(
      'Feature type that categorizes what kind of thing this is (e.g. "system", "component", "service", "log_pattern").'
    ),
  subtype: z.string().optional().describe('Optional finer-grained categorization within the type.'),
  title: z.string().optional().describe('Short human-readable label for display in the UI.'),
  description: z.string().describe('Human-readable description of what this feature represents.'),
  properties: z
    .record(z.string(), z.unknown())
    .describe(
      'Key-value pairs that uniquely identify this feature (e.g. { "service.name": "nginx" }). Must contain at least one entry.'
    ),
  confidence: z
    .number()
    .min(0)
    .max(100)
    .describe('Confidence score from 0 (uncertain) to 100 (certain) that this feature is present.'),
  evidence: z
    .array(z.string())
    .optional()
    .describe('Short strings or "key: value" pairs that support the presence of this feature.'),
  tags: z.array(z.string()).optional().describe('Tags for filtering and categorization.'),
  meta: z.record(z.string(), z.any()).optional().describe('Additional metadata not captured elsewhere.'),
});

const upsertFeaturesSchema = z.object({
  streamName: z.string().describe('The name of the stream to persist features for.'),
  features: z
    .array(featureInputSchema)
    .min(1)
    .describe('One or more features to persist. Each feature must have at least one property entry.'),
});

export const createUpsertFeaturesTool = ({
  getScopedClients,
  server,
}: {
  getScopedClients: GetScopedClients;
  server: StreamsServer;
}): BuiltinToolDefinition<typeof upsertFeaturesSchema> => {
  return {
    id: UPSERT_FEATURES_TOOL_ID,
    type: ToolType.builtin,
    description: `Persist one or more features into the streams feature store (backend storage for the Streams app). The data is saved to the feature store only. NEVER call attachment_add or attachment_update to store this tool's result — persistence is already complete.

Use this tool when you have already identified or composed features yourself (from your own analysis, user descriptions, or other tool results) and want to save them.

Features represent characteristics of the data in a stream, such as systems, components, services, or log patterns.

Each feature requires:
- \`id\`: a stable unique identifier (e.g. "nginx-access-logs")
- \`type\`: what kind of thing it is (e.g. "system", "component", "service")
- \`description\`: what this feature represents
- \`properties\`: key-value pairs that identify it (e.g. { "service.name": "nginx" })
- \`confidence\`: 0–100 score

Do NOT use this tool to run the automatic feature extraction pipeline — use \`streams.extract_features\` for that.`,
    schema: upsertFeaturesSchema,
    tags: [],
    handler: async ({ streamName, features: inputFeatures }, { request, logger }) => {
      const { featureClient, streamsClient, licensing, uiSettingsClient } = await getScopedClients({
        request,
      });

      try {
        await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });
      } catch (err) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Cannot upsert features: ${getErrorMessage(err)}` },
            },
          ],
        };
      }

      try {
        await streamsClient.ensureStream(streamName);
      } catch (err) {
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Stream "${streamName}" not found: ${getErrorMessage(err)}` },
            },
          ],
        };
      }

      const { hits: existingFeatures } = await featureClient.getFeatures(streamName);
      const nowMs = Date.now();

      const features = inputFeatures.map((input) => {
        const baseFeature = { ...input, stream_name: streamName };
        const existing = featureClient.findDuplicateFeature({
          existingFeatures,
          feature: baseFeature,
        });
        return {
          ...baseFeature,
          status: 'active' as const,
          last_seen: new Date(nowMs).toISOString(),
          expires_at: new Date(nowMs + MAX_FEATURE_AGE_MS).toISOString(),
          uuid: existing?.uuid ?? uuid(),
        };
      });

      await featureClient.bulk(
        streamName,
        features.map((feature) => ({ index: { feature } }))
      );

      logger.debug(`Upserted ${features.length} features for stream "${streamName}"`);

      return {
        results: [
          {
            type: ToolResultType.other,
            data: {
              streamName,
              featuresUpserted: features.length,
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
