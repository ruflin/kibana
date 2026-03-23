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
import type { StreamsServer } from '../../../types';
import type { GetScopedClients } from '../../../routes/types';
import { assertSignificantEventsAccess } from '../../../routes/utils/assert_significant_events_access';
import { writeQueryKnowledgeIndicatorHandler } from './handler';

export const STREAMS_WRITE_QUERY_KNOWLEDGE_INDICATOR_TOOL_ID =
  platformStreamsSigEventsTools.writeQueryKnowledgeIndicator;

const writeQueryKnowledgeIndicatorSchema = z.object({
  stream_name: z.string().describe('The name of the stream to write the query to.'),
  query_id: z
    .string()
    .describe(
      'Stable identifier for the query (e.g. "high_error_rate_query"). Used to upsert — re-using the same ID updates the existing query.'
    ),
  title: z.string().min(1).describe('Short human-readable title for the query.'),
  description: z.string().default('').describe('Detailed description of what this query detects.'),
  esql: z
    .object({
      query: z.string().describe(
        dedent`The ES|QL query string. Must include a FROM clause targeting the stream
          (e.g. FROM logs.* METADATA _id, _source) and METADATA _id, _source.`
      ),
    })
    .describe('The ES|QL query definition.'),
  severity_score: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      'Severity score from 0 (low) to 100 (critical), aligned with anomaly detection scoring.'
    ),
  evidence: z
    .array(z.string())
    .optional()
    .describe('Optional list of evidence strings supporting this query.'),
});

export function createWriteQueryKnowledgeIndicatorTool({
  getScopedClients,
  server,
  logger,
}: {
  getScopedClients: GetScopedClients;
  server: StreamsServer;
  logger: Logger;
}): StaticToolRegistration<typeof writeQueryKnowledgeIndicatorSchema> {
  const toolDefinition: BuiltinToolDefinition<typeof writeQueryKnowledgeIndicatorSchema> = {
    id: STREAMS_WRITE_QUERY_KNOWLEDGE_INDICATOR_TOOL_ID,
    type: ToolType.builtin,
    description: dedent`
      Write (upsert) a query-based Knowledge Indicator (KI) to a stream.

      Query KIs are ES|QL queries that detect significant events or conditions in a stream.
      They are persisted in the stream's asset store and surfaced when searching knowledge
      indicators. Queries can optionally be backed by alerting rules.

      Use this tool to:
      - Save a new ES|QL query that detects a meaningful condition on a stream
      - Update an existing query by re-writing it with the same \`query_id\`
      - Annotate a stream with a reusable detection query

      The ES|QL query must:
      - Include a FROM clause targeting the stream (e.g. FROM logs.myapp, logs.myapp.*)
      - Include METADATA _id, _source

      Requires user confirmation before writing.
    `,
    schema: writeQueryKnowledgeIndicatorSchema,
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
        const { streamsClient, queryClient, licensing, uiSettingsClient } = await getScopedClients({
          request,
        });

        await assertSignificantEventsAccess({ server, licensing, uiSettingsClient });

        const output = await writeQueryKnowledgeIndicatorHandler({
          streamsClient,
          queryClient,
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
        logger.error(`Error running write_query_knowledge_indicator: ${message}`);
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
                message: `Failed to write query knowledge indicator: ${message}`,
              },
            },
          ],
        };
      }
    },
  };

  return toolDefinition;
}
