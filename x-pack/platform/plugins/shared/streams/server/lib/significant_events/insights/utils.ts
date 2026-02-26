/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { Discovery, Insight, Recommendation } from '@kbn/streams-schema';
import {
  SUBMIT_DISCOVERIES_TOOL_NAME,
  SUBMIT_INSIGHTS_TOOL_NAME,
  SUBMIT_RECOMMENDATIONS_TOOL_NAME,
  parseDiscoveriesWithErrors,
  parseInsightsWithErrors,
  parseRecommendationsWithErrors,
} from './schema';

interface LlmResponse {
  toolCalls?: Array<{ function: { name: string; arguments: unknown } }>;
}

function findToolCallArgs(response: LlmResponse, toolName: string, logger: Logger): unknown {
  if (!response.toolCalls || response.toolCalls.length === 0) {
    logger.warn('LLM response has no tool calls');
    return undefined;
  }

  const toolCall = response.toolCalls.find((tc) => tc.function?.name === toolName);

  if (!toolCall || !toolCall.function?.arguments) {
    logger.warn(`${toolName} tool call missing arguments`);
    return undefined;
  }

  return toolCall.function.arguments;
}

export function extractDiscoveriesFromResponse(response: LlmResponse, logger: Logger): Discovery[] {
  const args = findToolCallArgs(response, SUBMIT_DISCOVERIES_TOOL_NAME, logger);
  if (!args) return [];

  const { discoveries, errors: validationErrors } = parseDiscoveriesWithErrors(args);

  if (validationErrors) {
    logger.warn(`Discoveries validation failed: ${validationErrors.message}`);
  }

  return discoveries;
}

export function extractInsightsFromResponse(response: LlmResponse, logger: Logger): Insight[] {
  const args = findToolCallArgs(response, SUBMIT_INSIGHTS_TOOL_NAME, logger);
  if (!args) return [];

  const { insights, errors: validationErrors } = parseInsightsWithErrors(args);

  if (validationErrors) {
    logger.warn(`Insights validation failed: ${validationErrors.message}`);
  }

  return insights;
}

export function extractRecommendationsFromResponse(
  response: LlmResponse,
  logger: Logger
): Recommendation[] {
  const args = findToolCallArgs(response, SUBMIT_RECOMMENDATIONS_TOOL_NAME, logger);
  if (!args) return [];

  const { recommendations, errors: validationErrors } = parseRecommendationsWithErrors(args);

  if (validationErrors) {
    logger.warn(`Recommendations validation failed: ${validationErrors.message}`);
  }

  return recommendations;
}
