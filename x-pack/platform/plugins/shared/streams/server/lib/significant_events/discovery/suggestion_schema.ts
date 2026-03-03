/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ToolSchema } from '@kbn/inference-common';
import { z } from '@kbn/zod';
import zodToJsonSchema from 'zod-to-json-schema';
import type { Suggestion } from '@kbn/streams-schema';

export const SUBMIT_SUGGESTIONS_TOOL_NAME = 'submit_suggestions';

const suggestionZodSchema = z.object({
  title: z.string().describe('Human-readable title for the suggestion'),
  description: z.string().describe('What the query does technically'),
  reason: z.string().describe('Why this query was selected, referencing the source discovery'),
  esql_query: z.string().describe('The actual ES|QL query string'),
  type: z
    .enum(['alert', 'dashboard', 'slo', 'viz'])
    .describe('What Kibana object to create from this query'),
  query_type: z
    .enum(['row', 'stats'])
    .default('row')
    .describe('ES|QL query type: row for filtering, stats for aggregation'),
  priority: z
    .enum(['critical', 'high', 'medium', 'low'])
    .describe('Priority derived from source discovery severity and relevance_score'),
  discovery_refs: z.array(z.string()).describe('Discovery UUIDs this suggestion came from'),
  stream_refs: z.array(z.string()).describe('Stream names the query targets'),
});

const suggestionsToolArgsZodSchema = z.object({
  suggestions: z.array(suggestionZodSchema),
});

export const suggestionsSchema = zodToJsonSchema(suggestionsToolArgsZodSchema, {
  $refStrategy: 'none',
}) as unknown as ToolSchema;

export const parseSuggestionsWithErrors = (
  data: unknown
): {
  suggestions: Array<Omit<Suggestion, 'uuid' | 'created_at' | 'status'>>;
  errors: z.ZodError | null;
} => {
  const result = suggestionsToolArgsZodSchema.safeParse(data);
  if (result.success) {
    return {
      suggestions: result.data.suggestions as Array<
        Omit<Suggestion, 'uuid' | 'created_at' | 'status'>
      >,
      errors: null,
    };
  }
  return { suggestions: [], errors: result.error };
};
