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
import { callStreamsFeatureCreate } from './call_streams_internal';

const schema = z.object({
  stream_name: z.string().describe('The stream name the feature belongs to.'),
  id: z
    .string()
    .describe(
      'A stable, human-readable identifier for the feature (e.g. "nginx-proxy", "payment-service-errors"). Used for deduplication.'
    ),
  type: z
    .string()
    .describe(
      'The feature type — e.g. "entity", "infrastructure", "schema", "pattern", "integration", "error_class".'
    ),
  subtype: z
    .string()
    .optional()
    .describe(
      'Optional subtype for further classification (e.g. "service", "cloud_deployment", "log_format").'
    ),
  title: z
    .string()
    .optional()
    .describe('Short human-readable title for the feature (e.g. "Nginx Reverse Proxy").'),
  description: z
    .string()
    .describe(
      'Detailed description of the feature — what it is, what role it plays in the system, and why it matters.'
    ),
  properties: z
    .record(z.string(), z.unknown())
    .describe(
      'Key-value metadata for the feature (e.g. {"service.name": "nginx", "host.name": "prod-web-01"}).'
    ),
  confidence: z
    .number()
    .min(0)
    .max(100)
    .describe(
      'Confidence score (0-100) in the accuracy of this feature identification. Use 80+ for features confirmed by data, 50-79 for inferred features.'
    ),
  evidence: z
    .array(z.string())
    .optional()
    .describe(
      'Evidence supporting the feature identification — log snippets, field values, or query results that confirm this feature exists.'
    ),
  tags: z
    .array(z.string())
    .optional()
    .describe('Tags for categorization (e.g. "agent-discovered", "incident-2024-03").'),
  meta: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Additional metadata (e.g. annotations, investigation context).'),
});

export const STREAMS_CREATE_FEATURE_TOOL_ID = `${internalNamespaces.streams}.create_feature`;

export const createCreateFeatureTool = ({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): BuiltinToolDefinition<typeof schema> => ({
  id: STREAMS_CREATE_FEATURE_TOOL_ID,
  type: ToolType.builtin,
  description: dedent`
    Persists a new feature (system, service, infrastructure component, pattern, or other
    identifiable entity) discovered during investigation into the Streams features index.

    When to use:
    - After discovering a new system, service, or component in log data that is not yet tracked
    - When investigation reveals a recurring pattern or error class worth recording
    - To register infrastructure components (hosts, containers, cloud resources) found in logs
    - When a feature was identified through manual analysis and should be persisted for future use

    When NOT to use:
    - For searching existing features (use streams.search_features)
    - For adding notes to an existing feature (use streams.annotate_feature)
    - For features that are auto-discovered by the Streams identification task — check first
      with streams.search_features to avoid duplicates

    Always search for existing features first with streams.search_features before creating
    a new one to avoid duplicates. The feature is persisted with status "active".
  `,
  schema,
  tags: ['streams', 'features', 'write'],
  availability: {
    cacheMode: 'space',
    handler: async ({ request }) => {
      return getAgentBuilderResourceAvailability({ core, request, logger });
    },
  },
  handler: async (params, { request, spaceId, logger: toolLogger }) => {
    try {
      const [coreStart] = await core.getStartServices();

      const body: Record<string, unknown> = {
        id: params.id,
        stream_name: params.stream_name,
        type: params.type,
        subtype: params.subtype,
        title: params.title,
        description: params.description,
        properties: params.properties,
        confidence: params.confidence,
        evidence: params.evidence,
        tags: params.tags,
        meta: params.meta,
      };

      const result = await callStreamsFeatureCreate(
        request,
        coreStart,
        spaceId,
        params.stream_name,
        body
      );

      return {
        results: [
          createOtherResult({
            type: 'create_feature',
            data: {
              success: true,
              feature_id: params.id,
              stream_name: params.stream_name,
              type: params.type,
              result,
            },
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLogger.error(`create_feature failed: ${message}`);
      return {
        results: [
          createErrorResult({
            message: `Create feature failed: ${message}`,
          }),
        ],
      };
    }
  },
});
