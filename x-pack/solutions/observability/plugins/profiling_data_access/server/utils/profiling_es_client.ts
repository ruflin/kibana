/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import type { ComposerQuery } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { ESQLSearchResponse, ESSearchRequest, InferSearchResponseOf } from '@kbn/es-types';
import type {
  AggregationField,
  BaseFlameGraph,
  ESTopNFunctions,
  ProfilingSchema,
  ProfilingStatusResponse,
  StackTraceResponse,
} from '@kbn/profiling-utils';

export interface ProfilingESClient {
  search<TDocument = unknown, TSearchRequest extends ESSearchRequest = ESSearchRequest>(
    operationName: string,
    searchRequest: TSearchRequest
  ): Promise<InferSearchResponseOf<TDocument, TSearchRequest>>;
  /**
   * Runs a composed ES|QL query. The Query DSL `filter` carries the clauses that are not a plain
   * `WHERE` (KQL, date ranges with a format). An index pattern that matches nothing yields an
   * empty response, as the lenient DSL searches did.
   */
  esql(
    operationName: string,
    query: ComposerQuery,
    filter?: QueryDslQueryContainer
  ): Promise<ESQLSearchResponse>;
  profilingStacktraces(params: {
    query: QueryDslQueryContainer;
    sampleSize: number;
    durationSeconds: number;
    co2PerKWH?: number;
    datacenterPUE?: number;
    pervCPUWattX86?: number;
    pervCPUWattArm64?: number;
    awsCostDiscountRate?: number;
    costPervCPUPerHour?: number;
    azureCostDiscountRate?: number;
    indices?: string[];
    stacktraceIdsField?: string;
    schema?: ProfilingSchema;
  }): Promise<StackTraceResponse>;
  /** Collects the stacktrace IDs held by a random sample of the documents matching `query` */
  sampleStacktraceIds(params: {
    query: QueryDslQueryContainer;
    indices: string[];
    stacktraceIdsField: string;
    /** Either 1 or at most 0.5, as the random sampler doesn't support values in between */
    probability: number;
    seed: number;
    preference: string;
    size: number;
  }): Promise<string[]>;
  getEsClient(): ElasticsearchClient;
  profilingFlamegraph(params: {
    query: QueryDslQueryContainer;
    sampleSize: number;
    durationSeconds: number;
    co2PerKWH?: number;
    datacenterPUE?: number;
    pervCPUWattX86?: number;
    pervCPUWattArm64?: number;
    awsCostDiscountRate?: number;
    azureCostDiscountRate?: number;
    costPervCPUPerHour?: number;
    indices?: string[];
    stacktraceIdsField?: string;
    schema?: ProfilingSchema;
  }): Promise<BaseFlameGraph>;
  topNFunctions(params: {
    query: QueryDslQueryContainer;
    limit?: number;
    sampleSize?: number;
    indices?: string[];
    stacktraceIdsField?: string;
    aggregationFields?: AggregationField[];
    co2PerKWH?: number;
    datacenterPUE?: number;
    pervCPUWattX86?: number;
    pervCPUWattArm64?: number;
    awsCostDiscountRate?: number;
    azureCostDiscountRate?: number;
    costPervCPUPerHour?: number;
    durationSeconds: number;
    schema?: ProfilingSchema;
  }): Promise<ESTopNFunctions>;
  universalProfiling: {
    status(params?: { waitForResourcesCreated?: boolean }): Promise<ProfilingStatusResponse>;
  };
}

export interface CreateProfilingEsClientParams {
  esClient: ElasticsearchClient;
  abortSignal?: AbortSignal;
}

export type CreateProfilingEsClient = (params: CreateProfilingEsClientParams) => ProfilingESClient;
