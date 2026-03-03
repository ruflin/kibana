/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { BoundInferenceClient, ChatCompletionTokenCount } from '@kbn/inference-common';
import { sumTokens } from '@kbn/streams-ai';
import type { ElasticsearchClient, IScopedClusterClient, Logger } from '@kbn/core/server';
import type { Streams, DiscoveryPipelineResult, Discovery } from '@kbn/streams-schema';
import type { LogMeta } from '@kbn/logging';
import { executeAsReasoningAgent } from '@kbn/inference-prompt-utils';
import type { QueryClient } from '../../streams/assets/query/query_client';
import type { StreamsClient } from '../../streams/client';
import type { DiscoveryClient } from '../../discoveries/discovery_client';
import type { FeatureClient } from '../../streams/feature/feature_client';
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
import { SUBMIT_DISCOVERIES_TOOL_NAME } from './schema';
import { createPipelineToolCallbacks, type PipelineToolDependencies } from './pipeline_tools';

export async function generateDiscoveries({
  streamsClient,
  queryClient,
  esClient,
  scopedClusterClient,
  inferenceClient,
  signal,
  logger,
  streamNames,
  discoveryClient,
  featureClient,
  connectorId,
}: {
  streamsClient: StreamsClient;
  queryClient: QueryClient;
  esClient: ElasticsearchClient;
  scopedClusterClient: IScopedClusterClient;
  inferenceClient: BoundInferenceClient;
  signal: AbortSignal;
  logger: Logger;
  streamNames?: string[];
  discoveryClient?: DiscoveryClient;
  featureClient?: FeatureClient;
  connectorId?: string;
}): Promise<DiscoveryPipelineResult> {
  const allStreams = await streamsClient.listStreams();
  let streams = allStreams;
  if (streamNames !== undefined && streamNames.length > 0) {
    const streamNamesSet = new Set(streamNames);
    streams = allStreams.filter((s) => streamNamesSet.has(s.name));
  }

  const toolDeps: PipelineToolDependencies | undefined =
    scopedClusterClient && featureClient && discoveryClient
      ? {
          esClient,
          scopedClusterClient,
          queryClient,
          featureClient,
          discoveryClient,
          logger,
        }
      : undefined;

  const streamDiscoveryResults = await Promise.all(
    streams.map(async (stream) => {
      const streamDiscoveryResult = await generateStreamDiscoveries({
        stream,
        queryClient,
        esClient,
        scopedClusterClient,
        inferenceClient,
        signal,
        logger,
        toolDeps,
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
    const enrichToolCallbacks = toolDeps ? createPipelineToolCallbacks(toolDeps) : {};
    const noopSubmit = async () => ({ response: { acknowledged: true } });

    const response = await executeAsReasoningAgent({
      prompt: EnrichDiscoveriesPrompt,
      input: {
        streamDiscoveries: JSON.stringify(streamDiscoveriesWithData),
      },
      inferenceClient,
      maxSteps: 6,
      toolCallbacks: {
        [SUBMIT_DISCOVERIES_TOOL_NAME]: noopSubmit,
        search_discoveries: enrichToolCallbacks.search_discoveries ?? noopSubmit,
        get_stream_features: enrichToolCallbacks.get_stream_features ?? noopSubmit,
        search_events: enrichToolCallbacks.search_events ?? noopSubmit,
      },
      finalToolChoice: { function: SUBMIT_DISCOVERIES_TOOL_NAME },
      abortSignal: signal,
    });

    const discoveries = extractDiscoveriesFromResponse(response, logger);

    const streamNamesByDiscovery = buildStreamRefsFromEvidence(discoveries, streamDiscoveriesWithData);
    const { featureRefs, queryRefs } = buildCrossRefsFromEvidence(discoveries, streamDiscoveriesWithData);

    const persistedDiscoveries: Discovery[] = [];
    if (discoveryClient && discoveries.length > 0) {
      const results = await Promise.all(
        discoveries.map((d, idx) =>
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
            feature_refs: featureRefs[idx] ?? [],
            query_refs: queryRefs[idx] ?? [],
            stream_refs: streamNamesByDiscovery[idx] ?? [],
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
  scopedClusterClient,
  inferenceClient,
  signal,
  logger,
  toolDeps,
}: {
  stream: Streams.all.Definition;
  queryClient: QueryClient;
  esClient: ElasticsearchClient;
  scopedClusterClient: IScopedClusterClient;
  inferenceClient: BoundInferenceClient;
  signal: AbortSignal;
  logger: Logger;
  toolDeps?: PipelineToolDependencies;
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
    const pipelineCallbacks = toolDeps ? createPipelineToolCallbacks(toolDeps) : {};
    const noopSubmit = async () => ({ response: { acknowledged: true } });

    const response = await executeAsReasoningAgent({
      prompt: ExtractDiscoveriesPrompt,
      input: {
        streamName: stream.name,
        queries: JSON.stringify(queryDataList),
      },
      inferenceClient,
      maxSteps: 8,
      toolCallbacks: {
        [SUBMIT_DISCOVERIES_TOOL_NAME]: noopSubmit,
        get_sig_events_with_change_points: pipelineCallbacks.get_sig_events_with_change_points ?? noopSubmit,
        get_log_patterns: pipelineCallbacks.get_log_patterns ?? noopSubmit,
        run_log_rate_analysis: pipelineCallbacks.run_log_rate_analysis ?? noopSubmit,
        search_events: pipelineCallbacks.search_events ?? noopSubmit,
        get_query_results: pipelineCallbacks.get_query_results ?? noopSubmit,
        get_stream_features: pipelineCallbacks.get_stream_features ?? noopSubmit,
        search_discoveries: pipelineCallbacks.search_discoveries ?? noopSubmit,
        get_query_definitions: pipelineCallbacks.get_query_definitions ?? noopSubmit,
      },
      finalToolChoice: { function: SUBMIT_DISCOVERIES_TOOL_NAME },
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

function buildStreamRefsFromEvidence(
  discoveries: Discovery[],
  streamDiscoveriesWithData: Array<{ streamName: string }>
): string[][] {
  return discoveries.map((d) => {
    const streamNames = new Set<string>();
    if (d.evidence) {
      for (const e of d.evidence) {
        if (e.stream_name) {
          streamNames.add(e.stream_name);
        }
      }
    }
    if (streamNames.size === 0) {
      return streamDiscoveriesWithData.map((s) => s.streamName);
    }
    return Array.from(streamNames);
  });
}

function buildCrossRefsFromEvidence(
  discoveries: Discovery[],
  streamDiscoveriesWithData: Array<{ streamName: string; discoveries: Discovery[] }>
): { featureRefs: string[][]; queryRefs: string[][] } {
  const featureRefs: string[][] = [];
  const queryRefs: string[][] = [];

  for (const d of discoveries) {
    const featureNames = new Set<string>();
    const queryTitles = new Set<string>();

    if (d.evidence) {
      for (const e of d.evidence) {
        if (e.feature_name) {
          featureNames.add(e.feature_name);
        }
        if (e.query_title) {
          queryTitles.add(e.query_title);
        }
      }
    }

    featureRefs.push(Array.from(featureNames));
    queryRefs.push(Array.from(queryTitles));
  }

  return { featureRefs, queryRefs };
}
