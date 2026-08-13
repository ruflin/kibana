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
  MAX_ID_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  QUERY_TYPE_MATCH,
  QUERY_TYPE_STATS,
} from '@kbn/significant-events-schema';
import { z } from '@kbn/zod/v4';
import dedent from 'dedent';
import type { StreamsServer } from '@kbn/streams-plugin/server/types';
import type { GetScopedClients } from '../../../routes/types';
import { assertSignificantEventsAccess } from '../../../routes/utils/assert_significant_events_access';
import { createSignificantEventsAvailability } from '../significant_events_availability';
import { getRequestAbortSignal } from '../../../routes/utils/get_request_abort_signal';
import { validateKiQueryToolHandler } from './handler';

export const SIGNIFICANT_EVENTS_VALIDATE_KI_QUERY_TOOL_ID =
  platformSignificantEventsTools.validateKiQuery;

const MAX_QUERIES_PER_CALL = 50;

const validateKiQueryItemSchema = z.object({
  esql: z.string().max(MAX_TEXT_LENGTH),
  title: z.string().max(MAX_TITLE_LENGTH),
  description: z
    .string()
    .max(MAX_TEXT_LENGTH)
    .describe(
      'A semantically searchable description explaining what the query detects and why it matters.'
    ),
  category: z.enum(['operational', 'configuration', 'error', 'resource_health', 'security']),
  severity_score: z.number().min(0).max(100),
  type: z
    .enum([QUERY_TYPE_MATCH, QUERY_TYPE_STATS])
    .optional()
    .describe(
      'Hint for query type. "match" for WHERE-only filters, "stats" for aggregation queries. The system derives the authoritative type from ES|QL content.'
    ),
  evidence: z.array(z.string().max(MAX_TEXT_LENGTH)).optional(),
  replaces: z
    .string()
    .max(MAX_ID_LENGTH)
    .optional()
    .describe('If this query replaces an existing one, set this to the existing query id.'),
  feature_ids: z
    .array(z.string().max(MAX_ID_LENGTH))
    .min(1)
    .max(50)
    .describe('IDs of stored stream features that informed this query.'),
});

const validateKiQuerySchema = z.object({
  stream_name: z.string().max(MAX_ID_LENGTH).describe('Target stream these queries are for.'),
  queries: z
    .array(validateKiQueryItemSchema)
    .min(1)
    .max(MAX_QUERIES_PER_CALL)
    .describe('Candidate queries to validate. Does not persist them or install alerting rules.'),
});

export function createValidateKiQueryTool({
  getScopedClients,
  server,
  logger,
}: {
  getScopedClients: GetScopedClients;
  server: StreamsServer;
  logger: Logger;
}): StaticToolRegistration<typeof validateKiQuerySchema> {
  const toolDefinition: BuiltinToolDefinition<typeof validateKiQuerySchema> = {
    id: SIGNIFICANT_EVENTS_VALIDATE_KI_QUERY_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      Validate candidate Knowledge Indicator ES|QL queries for a stream.

      Rewrites FROM sources, derives query type, checks feature_ids against stored
      features, rejects duplicates, and runs \`LIMIT 0\` syntax validation.
      Does not persist queries or install alerting rules — include valid queries
      in structured output so the workflow can persist them.
    `,
    schema: validateKiQuerySchema,
    tags: ['streams', 'significant-events'],
    confirmation: { askUser: 'never' },
    availability: createSignificantEventsAvailability({ server, logger }),
    handler: async ({ stream_name: streamName, queries }, context) => {
      try {
        const scopedClients = await getScopedClients({ request: context.request });
        await assertSignificantEventsAccess({
          server,
          licensing: scopedClients.licensing,
        });

        const stream = await scopedClients.streamsClient.getStream(streamName);
        const kiClient = await scopedClients.getKnowledgeIndicatorClient();
        const data = await validateKiQueryToolHandler({
          kiClient,
          esClient: scopedClients.streamDataEsClient,
          stream,
          queries,
          signal: getRequestAbortSignal(context.request),
          logger,
          queryValidationTimeoutMs: scopedClients.tuningConfig.query_validation_timeout_ms,
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
        logger.error(`Error running ki_query_validate: ${message}`);
        return {
          results: [
            {
              type: ToolResultType.error,
              data: { message: `Failed to validate KI queries: ${message}` },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
}
