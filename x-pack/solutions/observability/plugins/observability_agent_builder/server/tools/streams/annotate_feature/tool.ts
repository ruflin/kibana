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
import { callStreamsFeatureUpsert } from './call_streams_internal';

const FEATURES_INDEX = '.kibana_streams_features*';

const schema = z.object({
  stream_name: z.string().describe('The stream name the feature belongs to.'),
  feature_id: z
    .string()
    .describe(
      'The stable ID of the feature to annotate (from search_features results, field: feature.id).'
    ),
  annotation_note: z
    .string()
    .describe(
      'Investigation note to add — what was discovered about this feature during the investigation.'
    ),
  tags_to_add: z
    .array(z.string())
    .optional()
    .describe(
      'Additional tags to append to the feature (e.g. "investigated", "incident-2024-03").'
    ),
  confidence_adjustment: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      'Updated confidence score (0-100) if investigation revealed the feature is more or less relevant than originally scored.'
    ),
  related_insight_uuids: z
    .array(z.string())
    .optional()
    .describe('UUIDs of insights related to this feature.'),
  related_query_ids: z
    .array(z.string())
    .optional()
    .describe('IDs of significant event queries related to this feature.'),
});

export const STREAMS_ANNOTATE_FEATURE_TOOL_ID = `${internalNamespaces.streams}.annotate_feature`;

export const createAnnotateFeatureTool = ({
  core,
  logger,
}: {
  core: ObservabilityAgentBuilderCoreSetup;
  logger: Logger;
}): BuiltinToolDefinition<typeof schema> => ({
  id: STREAMS_ANNOTATE_FEATURE_TOOL_ID,
  type: ToolType.builtin,
  description: dedent`
    Enriches an existing stream feature with investigation context by adding notes, tags,
    and optionally adjusting the confidence score.

    When to use:
    - After investigating an incident and discovering new context about a feature
    - To mark a feature as investigated or link it to a specific incident
    - When investigation reveals a feature's confidence should be adjusted
    - To add tags that help future investigations find relevant features

    When NOT to use:
    - For creating new features (features are auto-discovered by the Streams plugin)
    - For searching features (use streams.search_features)
    - For deleting features

    Annotations are additive — existing tags and metadata are preserved.
    The annotation note is appended to the feature's meta.annotations array
    with a timestamp and source marker.
  `,
  schema,
  tags: ['streams', 'features', 'write'],
  availability: {
    cacheMode: 'space',
    handler: async ({ request }) => {
      return getAgentBuilderResourceAvailability({ core, request, logger });
    },
  },
  handler: async (params, { esClient, request, spaceId, logger: toolLogger }) => {
    try {
      const [coreStart] = await core.getStartServices();

      const searchResponse = await esClient.asCurrentUser.search({
        index: FEATURES_INDEX,
        size: 1,
        query: {
          bool: {
            filter: [
              { term: { 'feature.id': params.feature_id } },
              { term: { 'stream.name': params.stream_name } },
            ],
          },
        },
        _source: [
          'feature.id',
          'feature.uuid',
          'feature.type',
          'feature.subtype',
          'feature.title',
          'feature.description',
          'feature.properties',
          'feature.confidence',
          'feature.evidence',
          'feature.tags',
          'feature.meta',
          'feature.related_insight_uuids',
          'feature.related_query_ids',
          'stream.name',
        ],
      });

      const hit = searchResponse.hits.hits[0];
      if (!hit?._source) {
        return {
          results: [
            createErrorResult({
              message: `Feature "${params.feature_id}" not found in stream "${params.stream_name}".`,
            }),
          ],
        };
      }

      const source = hit._source as Record<string, unknown>;
      const feature = (source.feature ?? {}) as Record<string, unknown>;

      const existingTags = Array.isArray(feature.tags) ? (feature.tags as string[]) : [];
      const existingMeta = (feature.meta ?? {}) as Record<string, unknown>;
      const existingAnnotations = Array.isArray(existingMeta.annotations)
        ? (existingMeta.annotations as unknown[])
        : [];

      const annotation = {
        note: params.annotation_note,
        source: 'agent',
        timestamp: new Date().toISOString(),
      };

      const mergedTags = [...new Set([...existingTags, ...(params.tags_to_add ?? [])])];

      const mergedMeta = {
        ...existingMeta,
        annotations: [...existingAnnotations, annotation],
      };

      const existingInsightUuids = Array.isArray(feature.related_insight_uuids)
        ? (feature.related_insight_uuids as string[])
        : [];
      const existingQueryIds = Array.isArray(feature.related_query_ids)
        ? (feature.related_query_ids as string[])
        : [];

      const body: Record<string, unknown> = {
        id: feature.id ?? params.feature_id,
        stream_name: params.stream_name,
        type: feature.type ?? 'system',
        description: feature.description ?? '',
        properties: feature.properties ?? {},
        confidence:
          typeof params.confidence_adjustment === 'number'
            ? params.confidence_adjustment
            : (feature.confidence as number) ?? 50,
        evidence: feature.evidence,
        tags: mergedTags,
        meta: mergedMeta,
        title: feature.title,
        subtype: feature.subtype,
        related_insight_uuids: [
          ...new Set([...existingInsightUuids, ...(params.related_insight_uuids ?? [])]),
        ],
        related_query_ids: [
          ...new Set([...existingQueryIds, ...(params.related_query_ids ?? [])]),
        ],
      };

      const result = await callStreamsFeatureUpsert(
        request,
        coreStart,
        spaceId,
        params.stream_name,
        body
      );

      return {
        results: [
          createOtherResult({
            type: 'annotate_feature',
            data: {
              success: true,
              feature_id: params.feature_id,
              stream_name: params.stream_name,
              annotation,
              tags_added: params.tags_to_add ?? [],
              confidence_adjusted: typeof params.confidence_adjustment === 'number',
              result,
            },
          }),
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toolLogger.error(`annotate_feature failed: ${message}`);
      return {
        results: [
          createErrorResult({
            message: `Annotate feature failed: ${message}`,
          }),
        ],
      };
    }
  },
});
