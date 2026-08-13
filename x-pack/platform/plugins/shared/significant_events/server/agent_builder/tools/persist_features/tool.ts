/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { platformSignificantEventsTools, ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type { BuiltinToolDefinition, StaticToolRegistration } from '@kbn/agent-builder-server';
import type { Logger } from '@kbn/core/server';
import {
  ignoredFeatureSchema,
  MAX_ID_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
} from '@kbn/significant-events-schema';
import { z } from '@kbn/zod/v4';
import dedent from 'dedent';
import type { StreamsServer } from '@kbn/streams-plugin/server/types';
import type { GetScopedClients } from '../../../routes/types';
import { assertSignificantEventsAccess } from '../../../routes/utils/assert_significant_events_access';
import { createSignificantEventsAvailability } from '../significant_events_availability';
import { persistFeaturesToolHandler } from './handler';

export const SIGNIFICANT_EVENTS_PERSIST_FEATURES_TOOL_ID =
  platformSignificantEventsTools.persistFeatures;

const MAX_FEATURES_PER_CALL = 50;

const persistFeatureItemSchema = z.object({
  id: z.string().max(MAX_ID_LENGTH),
  type: z.enum(['entity', 'infrastructure', 'technology', 'dependency', 'schema']),
  subtype: z.string().max(MAX_ID_LENGTH),
  title: z.string().max(MAX_TITLE_LENGTH),
  description: z.string().max(MAX_TEXT_LENGTH),
  properties: z.record(z.string().max(MAX_ID_LENGTH), z.unknown()),
  confidence: z.number().min(0).max(100),
  evidence: z.array(z.string().max(MAX_TEXT_LENGTH)).max(5),
  evidence_doc_ids: z.array(z.string().max(MAX_ID_LENGTH)).optional(),
  tags: z.array(z.string().max(MAX_ID_LENGTH)),
  filter: z.unknown().optional(),
  meta: z.record(z.string().max(MAX_ID_LENGTH), z.unknown()).optional(),
});

const persistFeaturesSchema = z.object({
  stream_name: z.string().max(MAX_ID_LENGTH).describe('Target stream to persist features for.'),
  run_id: z
    .string()
    .max(MAX_ID_LENGTH)
    .describe('Extraction run id. Use the workflow execution id from the user message.'),
  features: z
    .array(persistFeatureItemSchema)
    .max(MAX_FEATURES_PER_CALL)
    .describe(
      'Deduplicated features supported by the current sample documents. Previously identified features are context, not an inventory to re-emit.'
    ),
  ignored_features: z
    .array(ignoredFeatureSchema)
    .max(MAX_FEATURES_PER_CALL)
    .optional()
    .describe('Candidates skipped because they match an excluded feature.'),
});

export function createPersistFeaturesTool({
  getScopedClients,
  server,
  logger,
}: {
  getScopedClients: GetScopedClients;
  server: StreamsServer;
  logger: Logger;
}): StaticToolRegistration<typeof persistFeaturesSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof persistFeaturesSchema> = {
    id: SIGNIFICANT_EVENTS_PERSIST_FEATURES_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      Reconcile and persist inferred Knowledge Indicator features for a stream.

      Use after reviewing a document sample. Does not create alerting rules.
      Returns new/updated feature summaries plus all features discovered in this run.
    `,
    schema: persistFeaturesSchema,
    tags: ['streams', 'significant-events'],
    confirmation: { askUser: 'never' },
    availability: createSignificantEventsAvailability({ server, logger }),
    handler: async (
      { stream_name: streamName, run_id: runId, features, ignored_features: ignoredFeatures },
      context
    ) => {
      try {
        const scopedClients = await getScopedClients({ request: context.request });
        await assertSignificantEventsAccess({
          server,
          licensing: scopedClients.licensing,
        });

        const kiClient = await scopedClients.getKnowledgeIndicatorClient();
        const data = await persistFeaturesToolHandler({
          kiClient,
          streamName,
          runId,
          features,
          ignoredFeatures,
          logger,
        });

        return {
          results: [
            {
              type: ToolResultType.other,
              data,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error running ki_feature_persist: ${message}`);
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to persist features: ${message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
}
