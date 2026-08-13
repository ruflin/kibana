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
  DEFAULT_SIGNIFICANT_EVENTS_TUNING_CONFIG,
  MAX_ID_LENGTH,
  SIGNIFICANT_EVENTS_TUNING_FIELD_BOUNDS,
} from '@kbn/significant-events-schema';
import { z } from '@kbn/zod/v4';
import dedent from 'dedent';
import type { StreamsServer } from '@kbn/streams-plugin/server/types';
import type { GetScopedClients } from '../../../routes/types';
import { assertSignificantEventsAccess } from '../../../routes/utils/assert_significant_events_access';
import { createSignificantEventsAvailability } from '../significant_events_availability';
import { sampleStreamDocumentsToolHandler } from './handler';

export const SIGNIFICANT_EVENTS_SAMPLE_STREAM_DOCUMENTS_TOOL_ID =
  platformSignificantEventsTools.sampleStreamDocuments;

const bounds = SIGNIFICANT_EVENTS_TUNING_FIELD_BOUNDS;

const sampleStreamDocumentsSchema = z.object({
  stream_name: z.string().max(MAX_ID_LENGTH).describe('Target stream to sample documents from.'),
  run_id: z
    .string()
    .max(MAX_ID_LENGTH)
    .optional()
    .describe(
      'Optional extraction run id. When set, entity-filtered sampling uses only features persisted in this run.'
    ),
  start: z
    .number()
    .optional()
    .describe('Start timestamp (epoch ms) for the sampling window. Defaults to 24h ago.'),
  end: z
    .number()
    .optional()
    .describe('End timestamp (epoch ms) for the sampling window. Defaults to now.'),
  iteration: z
    .number()
    .int()
    .min(1)
    .max(bounds.max_iterations.max ?? 20)
    .optional()
    .describe('1-based sampling iteration. Increment on each subsequent sample in the same run.'),
  sample_size: z
    .number()
    .int()
    .min(bounds.sample_size.min)
    .max(bounds.sample_size.max ?? 100)
    .optional()
    .describe(
      `Documents to return. Defaults to ${DEFAULT_SIGNIFICANT_EVENTS_TUNING_CONFIG.sample_size}.`
    ),
  entity_filtered_ratio: z
    .number()
    .min(bounds.entity_filtered_ratio.min)
    .max(bounds.entity_filtered_ratio.max ?? 1)
    .optional(),
  diverse_ratio: z
    .number()
    .min(bounds.diverse_ratio.min)
    .max(bounds.diverse_ratio.max ?? 1)
    .optional(),
  max_entity_filters: z
    .number()
    .int()
    .min(bounds.max_entity_filters.min)
    .max(bounds.max_entity_filters.max ?? 50)
    .optional(),
  sampling_timeout_ms: z
    .number()
    .int()
    .min(bounds.sampling_timeout_ms.min)
    .max(bounds.sampling_timeout_ms.max ?? 240_000)
    .optional(),
});

export function createSampleStreamDocumentsTool({
  getScopedClients,
  server,
  logger,
}: {
  getScopedClients: GetScopedClients;
  server: StreamsServer;
  logger: Logger;
}): StaticToolRegistration<typeof sampleStreamDocumentsSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof sampleStreamDocumentsSchema> = {
    id: SIGNIFICANT_EVENTS_SAMPLE_STREAM_DOCUMENTS_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      Sample log documents from a stream for Knowledge Indicator feature extraction.

      Mixes entity-filtered, diverse, and random documents. Call once per extraction
      iteration and increment \`iteration\` on each subsequent call in the same run.
      When a sample returns \`hasDocuments: false\`, stop sampling.
    `,
    schema: sampleStreamDocumentsSchema,
    tags: ['streams', 'significant-events'],
    confirmation: { askUser: 'never' },
    availability: createSignificantEventsAvailability({ server, logger }),
    handler: async (
      {
        stream_name: streamName,
        run_id: runId,
        start,
        end,
        iteration,
        sample_size: sampleSize,
        entity_filtered_ratio: entityFilteredRatio,
        diverse_ratio: diverseRatio,
        max_entity_filters: maxEntityFilters,
        sampling_timeout_ms: samplingTimeoutMs,
      },
      context
    ) => {
      try {
        const scopedClients = await getScopedClients({ request: context.request });
        await assertSignificantEventsAccess({
          server,
          licensing: scopedClients.licensing,
        });

        const stream = await scopedClients.streamsClient.getStream(streamName);
        const kiClient = await scopedClients.getKnowledgeIndicatorClient();
        const data = await sampleStreamDocumentsToolHandler({
          kiClient,
          samplingEsClient: scopedClients.streamDataEsClient,
          stream,
          tuningConfig: scopedClients.tuningConfig,
          params: {
            streamName,
            runId,
            start,
            end,
            iteration,
            sampleSize,
            entityFilteredRatio,
            diverseRatio,
            maxEntityFilters,
            samplingTimeoutMs,
          },
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
        logger.error(`Error running ki_sample_documents: ${message}`);
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to sample stream documents: ${message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
}
