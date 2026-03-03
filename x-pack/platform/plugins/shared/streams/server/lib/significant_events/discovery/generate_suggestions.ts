/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { BoundInferenceClient, ChatCompletionTokenCount } from '@kbn/inference-common';
import type { Logger } from '@kbn/core/server';
import type { Suggestion } from '@kbn/streams-schema';
import type { DiscoveryClient } from '../../discoveries/discovery_client';
import { getErrorMessage } from '../../streams/errors/parse_error';
import { GenerateSuggestionsPrompt } from './prompts/generate_suggestions/prompt';
import { extractSuggestionsFromResponse } from './utils';

export interface GenerateSuggestionsResult {
  suggestions: Suggestion[];
  tokensUsed: ChatCompletionTokenCount;
}

export async function generateSuggestionsFromDiscoveries({
  inferenceClient,
  signal,
  logger,
  discoveryClient,
}: {
  inferenceClient: BoundInferenceClient;
  signal: AbortSignal;
  logger: Logger;
  discoveryClient: DiscoveryClient;
}): Promise<GenerateSuggestionsResult> {
  const discoveries = await discoveryClient.searchDiscoveries({ size: 100 });

  if (discoveries.length === 0) {
    return {
      suggestions: [],
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
    };
  }

  const suggestionsResponse = await inferenceClient.prompt({
    prompt: GenerateSuggestionsPrompt,
    input: {
      discoveries: JSON.stringify(discoveries),
    },
    abortSignal: signal,
  });

  const rawSuggestions = extractSuggestionsFromResponse(suggestionsResponse, logger);

  const persistedSuggestions: Suggestion[] = [];
  if (rawSuggestions.length > 0) {
    const results = await Promise.all(
      rawSuggestions.map((s) =>
        discoveryClient.createSuggestion({
          title: s.title,
          description: s.description,
          reason: s.reason,
          type: s.type,
          esql_query: s.esql_query,
          query_type: s.query_type,
          priority: s.priority,
          discovery_refs: s.discovery_refs ?? [],
          stream_refs: s.stream_refs ?? [],
          status: 'pending',
        })
      )
    );
    persistedSuggestions.push(...results);
  }

  return {
    suggestions: persistedSuggestions,
    tokensUsed: suggestionsResponse.tokens ?? { prompt: 0, completion: 0, total: 0 },
  };
}
