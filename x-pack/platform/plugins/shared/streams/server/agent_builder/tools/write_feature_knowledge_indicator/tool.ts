/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod/v4';
import { platformStreamsSigEventsTools, ToolType } from '@kbn/agent-builder-common';
import { ToolResultType } from '@kbn/agent-builder-common/tools/tool_result';
import type {
  BuiltinToolDefinition,
  StaticToolRegistration,
  ToolAvailabilityResult,
} from '@kbn/agent-builder-server';
import type { Logger } from '@kbn/core/server';
import dedent from 'dedent';
import { conditionSchema } from '@kbn/streamlang';
import type { StreamsServer } from '../../../types';
import type { GetScopedClients } from '../../../routes/types';
import { assertSignificantEventsAccess } from '../../../routes/utils/assert_significant_events_access';
import { writeFeatureKnowledgeIndicatorHandler } from './handler';

export const STREAMS_WRITE_FEATURE_KNOWLEDGE_INDICATOR_TOOL_ID =
  platformStreamsSigEventsTools.writeFeatureKnowledgeIndicator;

const writeFeatureKnowledgeIndicatorSchema = z.object({
  stream_name: z.string().describe('The name of the stream to write the feature to.'),
  id: z.string().describe('Stable identifier for the feature (e.g. "high_error_rate_5xx").'),
  type: z
    .string()
    .describe(
      'Feature type category (e.g. "error_pattern", "traffic_anomaly", "service_degradation").'
    ),
  subtype: z.string().optional().describe('Optional sub-classification within the type.'),
  title: z.string().optional().describe('Short human-readable title for the feature.'),
  description: z
    .string()
    .describe('Detailed description of what this feature represents and why it is significant.'),
  properties: z
    .record(z.string(), z.unknown())
    .describe('Arbitrary key-value properties that characterize this feature.'),
  confidence: z
    .number()
    .min(0)
    .max(100)
    .describe('Confidence score from 0 (low) to 100 (high) that this feature is meaningful.'),
  evidence: z
    .array(z.string())
    .optional()
    .describe('Optional list of evidence strings supporting this feature.'),
  evidence_doc_ids: z
    .array(z.string())
    .optional()
    .describe('Optional list of document IDs that are evidence for this feature.'),
  tags: z.array(z.string()).optional().describe('Optional tags for categorization and filtering.'),
  filter: conditionSchema.optional().describe('Optional filter condition scoping this feature.'),
  meta: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Optional metadata for internal use.'),
});

export function createWriteFeatureKnowledgeIndicatorTool({
  getScopedClients,
  server,
  logger,
}: {
  getScopedClients: GetScopedClients;
  server: StreamsServer;
  logger: Logger;
}): StaticToolRegistration<typeof writeFeatureKnowledgeIndicatorSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof writeFeatureKnowledgeIndicatorSchema> = {
    id: STREAMS_WRITE_FEATURE_KNOWLEDGE_INDICATOR_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      Write (upsert) a feature-based Knowledge Indicator (KI) to a stream.

      Feature KIs capture observed characteristics of a stream such as error patterns,
      traffic anomalies, or service degradations. They are persisted in the stream's
      feature store and surfaced when searching knowledge indicators.

      Use this tool to:
      - Record a newly identified feature pattern on a stream
      - Update an existing feature by re-writing it with the same \`id\`
      - Annotate a stream with domain knowledge about its data shape

      Requires user confirmation before writing.
    `,
    schema: writeFeatureKnowledgeIndicatorSchema,
    tags: ['streams', 'significant_events', 'knowledge_indicators'],
    confirmation: {
      askUser: 'once',
    },
    availability: {
      cacheMode: 'space',
      handler: async ({ request, uiSettings }): Promise<ToolAvailabilityResult> => {
        try {
          const { licensing } = await getScopedClients({ request });
          await assertSignificantEventsAccess({ server, licensing, uiSettingsClient: uiSettings });
          return { status: 'available' };
        } catch (error) {
          if (error instanceof Error) {
            logger.debug(error.stack ?? error.message);
          } else {
            logger.debug(String(error));
          }
          return {
            status: 'unavailable',
            reason:
              error instanceof Error
                ? error.message
                : 'Significant events access is not available in the current context',
          };
        }
      },
    },
    handler: async (toolParams, context) => {
      const { request } = context;

      try {
        const { streamsClient, featureClient, licensing, uiSettingsClient } =
          await getScopedClients({ request });

        await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

        const output = await writeFeatureKnowledgeIndicatorHandler({
          streamsClient,
          featureClient,
          logger,
          params: toolParams,
        });

        return {
          results: [
            {
              type: ToolResultType.other,
              data: output,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error running write_feature_knowledge_indicator: ${message}`);
        if (error instanceof Error) {
          logger.debug(error.stack ?? error.message);
        } else {
          logger.debug(String(error));
        }

        return {
          results: [
            {
              type: ToolResultType.error,
              data: {
                message: `Failed to write feature knowledge indicator: ${message}`,
              },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
}
