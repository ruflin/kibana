/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { BoundInferenceClient, ChatCompletionTokenCount } from '@kbn/inference-common';
import { sumTokens } from '@kbn/streams-ai';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { Streams, DiscoveryPipelineResult } from '@kbn/streams-schema';
import type { LogMeta } from '@kbn/logging';
import type { QueryClient } from '../../streams/assets/query/query_client';
import type { StreamsClient } from '../../streams/client';
import type { DiscoveryClient } from '../../discoveries/discovery_client';
import { getErrorMessage } from '../../streams/errors/parse_error';
import { ExtractDiscoveriesPrompt } from './prompts/extract_discoveries/prompt';
import { EnrichDiscoveriesPrompt } from './prompts/enrich_discoveries/prompt';
import { GenerateSuggestionsPrompt } from './prompts/generate_suggestions/prompt';
import {
  extractDiscoveriesFromResponse,
  extractSuggestionsFromResponse,
  collectQueryData,
  type QueryData,
} from './utils';

export async function generateDiscoveries({
  streamsClient,
  queryClient,
  esClient,
  inferenceClient,
  signal,
  logger,
  streamNames,
  discoveryClient,
  connectorId,
}: {
  streamsClient: StreamsClient;
  queryClient: QueryClient;
  esClient: ElasticsearchClient;
  inferenceClient: BoundInferenceClient;
  signal: AbortSignal;
  logger: Logger;
  streamNames?: string[];
  discoveryClient?: DiscoveryClient;
  connectorId?: string;
}): Promise<DiscoveryPipelineResult> {
  const allStreams = await streamsClient.listStreams();
  let streams = allStreams;
  if (streamNames !== undefined && streamNames.length > 0) {
    const streamNamesSet = new Set(streamNames);
    streams = allStreams.filter((s) => streamNamesSet.has(s.name));
  }
  const streamDiscoveryResults = await Promise.all(
    streams.map(async (stream) => {
      const streamDiscoveryResult = await generateStreamDiscoveries({
        stream,
        queryClient,
        esClient,
        inferenceClient,
        signal,
        logger,
      });
      return {
        streamName: stream.name,
        ...streamDiscoveryResult,
      };
    })
  );

  const streamDiscoveriesWithData = streamDiscoveryResults.filter(
    (result) => result.discoveries.length > 0
  );

  const tokensUsed = streamDiscoveryResults.reduce<ChatCompletionTokenCount>(
    (acc, result) => sumTokens(acc, result.tokensUsed),
    { prompt: 0, completion: 0, total: 0 }
  );

  if (streamDiscoveriesWithData.length === 0) {
    return {
      discoveries: [],
      suggestions: [],
      tokensUsed,
    };
  }

  try {
    const response = await inferenceClient.prompt({
      prompt: EnrichDiscoveriesPrompt,
      input: {
        streamDiscoveries: JSON.stringify(streamDiscoveriesWithData),
      },
      abortSignal: signal,
    });

    const discoveries = extractDiscoveriesFromResponse(response, logger);

    const persistedDiscoveries = [];
    if (discoveryClient && discoveries.length > 0) {
      const results = await Promise.all(
        discoveries.map((d) =>
          discoveryClient.createDiscovery({
            title: d.title,
            description: d.description,
            severity: d.severity ?? 'medium',
            relevance_score: d.relevance_score ?? 50,
            evidence: d.evidence ?? [],
            sample_events: d.sample_events,
            recommendations: d.recommendations?.map((r) =>
              typeof r === 'string'
                ? { title: r, description: r, priority: 'medium' as const, steps: [r] }
                : r
            ),
            feature_refs: [],
            query_refs: [],
            stream_refs: streamDiscoveriesWithData.map((s) => s.streamName),
            level: 0,
            connector_id: connectorId ?? '',
            tags: [],
          })
        )
      );
      persistedDiscoveries.push(...results);
    }

    let stage2Tokens = sumTokens(tokensUsed, response.tokens);

    // Stage 3: Generate Suggestions
    const suggestionsInput = persistedDiscoveries.length > 0 ? persistedDiscoveries : discoveries;
    let suggestions: DiscoveryPipelineResult['suggestions'] = [];

    if (suggestionsInput.length > 0) {
      try {
        const suggestionsResponse = await inferenceClient.prompt({
          prompt: GenerateSuggestionsPrompt,
          input: {
            discoveries: JSON.stringify(suggestionsInput),
          },
          abortSignal: signal,
        });

        const rawSuggestions = extractSuggestionsFromResponse(suggestionsResponse, logger);

        if (discoveryClient && rawSuggestions.length > 0) {
          const persistedSuggestions = await Promise.all(
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
          suggestions = persistedSuggestions;
        } else {
          suggestions = rawSuggestions.map((s) => ({
            ...s,
            uuid: '',
            created_at: new Date().toISOString(),
            status: 'pending' as const,
          }));
        }

        stage2Tokens = sumTokens(stage2Tokens, suggestionsResponse.tokens);
      } catch (suggestError) {
        logger.warn(`Stage 3 (suggestion generation) failed: ${getErrorMessage(suggestError)}`);
      }
    }

    return {
      discoveries: persistedDiscoveries.length > 0 ? persistedDiscoveries : discoveries,
      suggestions,
      tokensUsed: stage2Tokens,
    };
  } catch (error) {
    if (
      getErrorMessage(error).includes(`The request exceeded the model's maximum context length`)
    ) {
      logger.debug(
        `Context too big when generating system discoveries, number of streams: ${streamDiscoveriesWithData.length}`,
        { error } as LogMeta
      );
      return {
        discoveries: [],
        suggestions: [],
        tokensUsed,
      };
    }

    throw error;
  }
}

async function generateStreamDiscoveries({
  stream,
  queryClient,
  esClient,
  inferenceClient,
  signal,
  logger,
}: {
  stream: Streams.all.Definition;
  queryClient: QueryClient;
  esClient: ElasticsearchClient;
  inferenceClient: BoundInferenceClient;
  signal: AbortSignal;
  logger: Logger;
}): Promise<DiscoveryPipelineResult> {
  const queries = await queryClient.getAssets(stream.name);

  const queryDataResults = await Promise.all(
    queries.map((query) =>
      collectQueryData({
        query,
        esClient,
      })
    )
  );

  const queryDataList = queryDataResults.filter((data): data is QueryData => data !== undefined);

  if (queryDataList.length === 0) {
    return {
      discoveries: [],
      suggestions: [],
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
    };
  }

  try {
    const response = await inferenceClient.prompt({
      prompt: ExtractDiscoveriesPrompt,
      input: {
        streamName: stream.name,
        queries: JSON.stringify(queryDataList),
      },
      abortSignal: signal,
    });

    const discoveries = extractDiscoveriesFromResponse(response, logger);

    return {
      discoveries,
      suggestions: [],
      tokensUsed: response.tokens ?? { prompt: 0, completion: 0, total: 0 },
    };
  } catch (error) {
    if (
      getErrorMessage(error).includes(`The request exceeded the model's maximum context length`)
    ) {
      logger.debug(
        `Context too big when generating discoveries for stream ${stream.name}, number of queries: ${queryDataList.length}`,
        { error } as LogMeta
      );
      return {
        discoveries: [],
        suggestions: [],
        tokensUsed: { prompt: 0, completion: 0, total: 0 },
      };
    }

    throw error;
  }
}
