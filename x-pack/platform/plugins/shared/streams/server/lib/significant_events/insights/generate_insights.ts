/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { BoundInferenceClient, ChatCompletionTokenCount } from '@kbn/inference-common';
import { sumTokens } from '@kbn/streams-ai';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { DiscoveryPipelineResult, Streams } from '@kbn/streams-schema';
import type { LogMeta } from '@kbn/logging';
import { executeAsReasoningAgent } from '@kbn/inference-prompt-utils';
import type { QueryClient } from '../../streams/assets/query/query_client';
import type { StreamsClient } from '../../streams/client';
import type { FeatureClient } from '../../streams/feature/feature_client';
import { getErrorMessage } from '../../streams/errors/parse_error';
import { ExtractDiscoveriesPrompt } from './prompts/extract_discoveries/prompt';
import { GenerateInsightsPrompt } from './prompts/generate_insights/prompt';
import { GenerateRecommendationsPrompt } from './prompts/generate_recommendations/prompt';
import {
  extractDiscoveriesFromResponse,
  extractInsightsFromResponse,
  extractRecommendationsFromResponse,
} from './utils';
import { SUBMIT_DISCOVERIES_TOOL_NAME } from './schema';
import { SUBMIT_INSIGHTS_TOOL_NAME } from './schema';
import {
  createGetStreamFeaturesCallback,
  createSearchEventsCallback,
  createGetQueryDefinitionsCallback,
  createGetQueryResultsCallback,
} from './tools/tool_callbacks';
import {
  GET_STREAM_FEATURES_TOOL_NAME,
  SEARCH_EVENTS_TOOL_NAME,
  GET_QUERY_DEFINITIONS_TOOL_NAME,
  GET_QUERY_RESULTS_TOOL_NAME,
} from './tools/tool_schemas';

const EMPTY_TOKENS: ChatCompletionTokenCount = { prompt: 0, completion: 0, total: 0 };

const EMPTY_RESULT: DiscoveryPipelineResult = {
  discoveries: [],
  insights: [],
  recommendations: [],
  tokensUsed: EMPTY_TOKENS,
};

const DISCOVERY_MAX_STEPS = 8;
const INSIGHTS_MAX_STEPS = 6;

export async function generateInsights({
  streamsClient,
  queryClient,
  featureClient,
  esClient,
  inferenceClient,
  signal,
  logger,
  streamNames,
}: {
  streamsClient: StreamsClient;
  queryClient: QueryClient;
  featureClient: FeatureClient;
  esClient: ElasticsearchClient;
  inferenceClient: BoundInferenceClient;
  signal: AbortSignal;
  logger: Logger;
  streamNames?: string[];
}): Promise<DiscoveryPipelineResult> {
  const allStreams = await streamsClient.listStreams();
  let streams = allStreams;
  if (streamNames !== undefined && streamNames.length > 0) {
    const streamNamesSet = new Set(streamNames);
    streams = allStreams.filter((s) => streamNamesSet.has(s.name));
  }

  if (streams.length === 0) {
    return EMPTY_RESULT;
  }

  // --- Stage 1: Extract discoveries using reasoning agent ---
  const { discoveries: allDiscoveries, tokensUsed: discoveryTokens } =
    await extractDiscoveriesWithAgent({
      streams,
      queryClient,
      featureClient,
      esClient,
      inferenceClient,
      signal,
      logger,
    });

  let tokensUsed = discoveryTokens;

  if (allDiscoveries.length === 0) {
    return { ...EMPTY_RESULT, tokensUsed };
  }

  // --- Stage 2: Generate insights using reasoning agent ---
  try {
    const insightsResult = await generateInsightsWithAgent({
      discoveries: allDiscoveries,
      queryClient,
      featureClient,
      esClient,
      inferenceClient,
      signal,
      logger,
    });

    const { insights } = insightsResult;
    tokensUsed = sumTokens(tokensUsed, insightsResult.tokensUsed);

    if (insights.length === 0) {
      return { discoveries: allDiscoveries, insights: [], recommendations: [], tokensUsed };
    }

    // --- Stage 3: Generate recommendations (single-shot, no tools needed) ---
    const recommendationsResponse = await inferenceClient.prompt({
      prompt: GenerateRecommendationsPrompt,
      input: {
        insights: JSON.stringify(insights),
      },
      abortSignal: signal,
    });

    const recommendations = extractRecommendationsFromResponse(recommendationsResponse, logger);
    tokensUsed = sumTokens(tokensUsed, recommendationsResponse.tokens);

    return {
      discoveries: allDiscoveries,
      insights,
      recommendations,
      tokensUsed,
    };
  } catch (error) {
    if (
      getErrorMessage(error).includes(`The request exceeded the model's maximum context length`)
    ) {
      logger.debug(
        `Context too big when generating insights/recommendations, number of discoveries: ${allDiscoveries.length}`,
        { error } as LogMeta
      );
      return { discoveries: allDiscoveries, insights: [], recommendations: [], tokensUsed };
    }

    throw error;
  }
}

async function extractDiscoveriesWithAgent({
  streams,
  queryClient,
  featureClient,
  esClient,
  inferenceClient,
  signal,
  logger,
}: {
  streams: Streams.all.Definition[];
  queryClient: QueryClient;
  featureClient: FeatureClient;
  esClient: ElasticsearchClient;
  inferenceClient: BoundInferenceClient;
  signal: AbortSignal;
  logger: Logger;
}) {
  const streamNamesList = streams.map((s) => s.name);

  try {
    logger.debug(
      `Extracting discoveries via reasoning agent for ${streamNamesList.length} streams`
    );

    const response = await executeAsReasoningAgent({
      prompt: ExtractDiscoveriesPrompt,
      input: {
        streamNames: streamNamesList.join('\n'),
      },
      inferenceClient,
      maxSteps: DISCOVERY_MAX_STEPS,
      toolCallbacks: {
        [GET_STREAM_FEATURES_TOOL_NAME]: createGetStreamFeaturesCallback({
          featureClient,
          logger,
        }),
        [GET_QUERY_DEFINITIONS_TOOL_NAME]: createGetQueryDefinitionsCallback({
          queryClient,
          logger,
        }),
        [GET_QUERY_RESULTS_TOOL_NAME]: createGetQueryResultsCallback({
          esClient,
          queryClient,
          logger,
        }),
        [SEARCH_EVENTS_TOOL_NAME]: createSearchEventsCallback({ esClient, logger }),
        [SUBMIT_DISCOVERIES_TOOL_NAME]: async (toolCall) => {
          return { response: { status: 'accepted' } };
        },
      },
      finalToolChoice: { function: SUBMIT_DISCOVERIES_TOOL_NAME },
      abortSignal: signal,
    });

    const discoveries = extractDiscoveriesFromResponse(response, logger);

    return {
      discoveries,
      tokensUsed: response.tokens ?? EMPTY_TOKENS,
    };
  } catch (error) {
    if (
      getErrorMessage(error).includes(`The request exceeded the model's maximum context length`)
    ) {
      logger.debug(
        `Context too big when extracting discoveries, streams: ${streamNamesList.join(', ')}`,
        { error } as LogMeta
      );
      return { discoveries: [], tokensUsed: EMPTY_TOKENS };
    }

    throw error;
  }
}

async function generateInsightsWithAgent({
  discoveries,
  queryClient,
  featureClient,
  esClient,
  inferenceClient,
  signal,
  logger,
}: {
  discoveries: DiscoveryPipelineResult['discoveries'];
  queryClient: QueryClient;
  featureClient: FeatureClient;
  esClient: ElasticsearchClient;
  inferenceClient: BoundInferenceClient;
  signal: AbortSignal;
  logger: Logger;
}) {
  logger.debug(`Generating insights via reasoning agent from ${discoveries.length} discoveries`);

  const response = await executeAsReasoningAgent({
    prompt: GenerateInsightsPrompt,
    input: {
      discoveries: JSON.stringify(discoveries),
    },
    inferenceClient,
    maxSteps: INSIGHTS_MAX_STEPS,
    toolCallbacks: {
      [GET_STREAM_FEATURES_TOOL_NAME]: createGetStreamFeaturesCallback({
        featureClient,
        logger,
      }),
      [GET_QUERY_DEFINITIONS_TOOL_NAME]: createGetQueryDefinitionsCallback({
        queryClient,
        logger,
      }),
      [SEARCH_EVENTS_TOOL_NAME]: createSearchEventsCallback({ esClient, logger }),
      [SUBMIT_INSIGHTS_TOOL_NAME]: async (toolCall) => {
        return { response: { status: 'accepted' } };
      },
    },
    finalToolChoice: { function: SUBMIT_INSIGHTS_TOOL_NAME },
    abortSignal: signal,
  });

  const insights = extractInsightsFromResponse(response, logger);

  return {
    insights,
    tokensUsed: response.tokens ?? EMPTY_TOKENS,
  };
}
