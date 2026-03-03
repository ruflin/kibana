/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { omit } from 'lodash';
import type { Condition } from '@kbn/streamlang';
import type { Discovery, Suggestion } from '@kbn/streams-schema';
import { parse as parseEsql } from '@kbn/esql-language';
import type { Query } from '../../../../common/queries';
import { parseError } from '../../streams/errors/parse_error';
import { SecurityError } from '../../streams/errors/security_error';
import { SUBMIT_DISCOVERIES_TOOL_NAME, parseDiscoveriesWithErrors } from './schema';
import { SUBMIT_SUGGESTIONS_TOOL_NAME, parseSuggestionsWithErrors } from './suggestion_schema';

export interface QueryData {
  title: string;
  kql: string;
  feature?: {
    name: string;
    filter: Condition;
  };
  currentCount: number;
  sampleEvents: string[];
}

const SAMPLE_EVENTS_COUNT = 5;
const CURRENT_WINDOW_MINUTES = 15;

export function extractDiscoveriesFromResponse(
  response: { toolCalls?: Array<{ function: { name: string; arguments: unknown } }> },
  logger: Logger
): Discovery[] {
  if (!response.toolCalls || response.toolCalls.length === 0) {
    logger.warn('LLM response has no tool calls');
    return [];
  }

  const toolCall = response.toolCalls.find(
    (tc) => tc.function?.name === SUBMIT_DISCOVERIES_TOOL_NAME
  );

  if (!toolCall || !toolCall.function?.arguments) {
    logger.warn(`${SUBMIT_DISCOVERIES_TOOL_NAME} tool call missing arguments`);
    return [];
  }

  const { discoveries, errors: validationErrors } = parseDiscoveriesWithErrors(
    toolCall.function.arguments
  );

  if (validationErrors) {
    logger.warn(`Discoveries validation failed: ${validationErrors.message}`);
  }

  return discoveries;
}

export function validateEsqlQuery(query: string): { valid: boolean; errors: string[] } {
  if (!query || !query.trim()) {
    return { valid: false, errors: ['Empty query'] };
  }

  try {
    const result = parseEsql(query);
    if (result.errors && result.errors.length > 0) {
      return {
        valid: false,
        errors: result.errors.map((e) => ('message' in e ? (e as { message: string }).message : String(e))),
      };
    }
    return { valid: true, errors: [] };
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

export function extractSuggestionsFromResponse(
  response: { toolCalls?: Array<{ function: { name: string; arguments: unknown } }> },
  logger: Logger
): Array<Omit<Suggestion, 'uuid' | 'created_at' | 'status'>> {
  if (!response.toolCalls || response.toolCalls.length === 0) {
    logger.warn('LLM response has no tool calls for suggestions');
    return [];
  }

  const toolCall = response.toolCalls.find(
    (tc) => tc.function?.name === SUBMIT_SUGGESTIONS_TOOL_NAME
  );

  if (!toolCall || !toolCall.function?.arguments) {
    logger.warn(`${SUBMIT_SUGGESTIONS_TOOL_NAME} tool call missing arguments`);
    return [];
  }

  const { suggestions, errors: validationErrors } = parseSuggestionsWithErrors(
    toolCall.function.arguments
  );

  if (validationErrors) {
    logger.warn(`Suggestions validation failed: ${validationErrors.message}`);
  }

  const validSuggestions = suggestions.filter((s) => {
    if (s.type === 'investigation') {
      return true;
    }
    const { valid, errors } = validateEsqlQuery(s.esql_query);
    if (!valid) {
      logger.warn(`Rejecting suggestion "${s.title}" — invalid ES|QL: ${errors.join(', ')}`);
    }
    return valid;
  });

  return validSuggestions;
}

export async function collectQueryData({
  query,
  esClient,
}: {
  query: Query;
  esClient: ElasticsearchClient;
}): Promise<QueryData | undefined> {
  const { rule_id: ruleId } = query;

  const currentResponse = await esClient
    .search<{ original_source: Record<string, unknown> }>({
      index: '.alerts-streams.alerts-default',
      size: SAMPLE_EVENTS_COUNT,
      query: {
        bool: {
          filter: [
            {
              range: {
                '@timestamp': {
                  gte: `now-${CURRENT_WINDOW_MINUTES}m`,
                  lte: 'now',
                },
              },
            },
            {
              term: {
                'kibana.alert.rule.uuid': ruleId,
              },
            },
          ],
        },
      },
      track_total_hits: true,
    })
    .catch((err) => {
      const { type, message } = parseError(err);
      if (type === 'security_exception') {
        throw new SecurityError(
          `Cannot read Significant events, insufficient privileges: ${message}`,
          { cause: err }
        );
      }
      throw err;
    });

  const currentCount =
    typeof currentResponse.hits.total === 'number'
      ? currentResponse.hits.total
      : currentResponse.hits.total?.value ?? 0;

  if (currentCount === 0) {
    return undefined;
  }

  const sampleEvents = currentResponse.hits.hits.map((hit) =>
    JSON.stringify(omit(hit._source?.original_source ?? {}, '_id'))
  );

  return {
    title: query.query.title,
    kql: query.query.kql.query,
    feature: query.query.feature
      ? { name: query.query.feature.name, filter: query.query.feature.filter }
      : undefined,
    currentCount,
    sampleEvents,
  };
}
