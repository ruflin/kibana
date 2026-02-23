/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z } from '@kbn/zod';
import { ToolType } from '@kbn/agent-builder-common';
import { internalNamespaces } from '@kbn/agent-builder-common/base/namespaces';
import type { BuiltinToolDefinition } from '@kbn/agent-builder-server';
import { createErrorResult, createOtherResult } from '@kbn/agent-builder-server';
import type { Logger } from '@kbn/core/server';
import dedent from 'dedent';
import type { ObservabilityAgentBuilderCoreSetup } from '../../../types';
import { getAgentBuilderResourceAvailability } from '../../../utils/get_agent_builder_resource_availability';
import { callStreamsQueryUpsert } from './call_streams_internal';

const schema = z.object({
  stream_name: z.string().describe('The stream name to associate the query with.'),
  title: z
    .string()
    .describe(
      'Descriptive title for the significant event query (e.g. "High error rate in payment service").'
    ),
  kql_query: z
    .string()
    .describe(
      'KQL query string that detects the pattern (e.g. "log.level: error AND service.name: payments").'
    ),
  severity_score: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Severity score 0-100 aligned with anomaly detection scoring.'),
  evidence: z
    .array(z.string())
    .optional()
    .describe(
      'Evidence for why this query is useful — e.g. "Pattern appeared in 3 incidents over the last week".'
    ),
});

export const STREAMS_SUGGEST_QUERY_TOOL_ID = `${internalNamespaces.streams}.suggest_query`;

export const createSuggestQueryTool = ({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): BuiltinToolDefinition<typeof schema> => ({
  id: STREAMS_SUGGEST_QUERY_TOOL_ID,
  type: ToolType.builtin,
  description: dedent`
    Proposes a new significant event query for a stream based on patterns discovered during investigation.
    The query is created via the Streams API and can be promoted to a Kibana rule by a human reviewer.

    When to use:
    - After discovering a recurring error pattern that should be monitored
    - When investigation reveals a condition worth detecting in the future
    - To suggest a KQL query that would catch similar incidents proactively

    When NOT to use:
    - For one-off queries or ad-hoc data exploration (use execute_esql)
    - For searching existing queries (use streams.search_queries)
    - When the pattern is already covered by an existing significant event query

    The query is stored in .kibana_streams_assets and can be promoted to an active
    detector (Kibana rule) by an SRE via the Streams UI.
    Include evidence explaining why the query is valuable.
  `,
  schema,
  tags: ['streams', 'queries', 'write'],
  availability: {
    cacheMode: 'space',
    handler: async ({ request }) => {
      return getAgentBuilderResourceAvailability({ core, request, logger });
    },
  },
  handler: async (params, { request, spaceId, logger: toolLogger }) => {
    try {
      const [coreStart] = await core.getStartServices();

      const queryId = `agent-suggested-${params.stream_name}-${Date.now()}`;

      const body = {
        title: params.title,
        kql: { query: params.kql_query },
        severity_score: params.severity_score,
        evidence: params.evidence,
      };

      const result = await callStreamsQueryUpsert(
        request,
        coreStart,
        spaceId,
        params.stream_name,
        queryId,
        body
      );

      return {
        results: [
          createOtherResult({
            type: 'suggest_query',
            data: {
              success: true,
              query_id: queryId,
              stream_name: params.stream_name,
              title: params.title,
              result,
            },
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLogger.error(`suggest_query failed: ${message}`);
      return {
        results: [
          createErrorResult({
            message: `Suggest query failed: ${message}`,
          }),
        ],
      };
    }
  },
});
