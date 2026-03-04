/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { Streams } from '@kbn/streams-schema';

/**
 * Options passed to each computed feature generator.
 */
export interface ComputedFeatureGeneratorOptions {
  stream: Streams.all.Definition;
  start: number;
  end: number;
  esClient: ElasticsearchClient;
  logger: Logger;
}

/**
 * Stream data types that computed feature generators can be scoped to.
 * Derived from the stream name prefix (e.g. "logs-*", "metrics-*", "traces-*").
 */
export type StreamDataType = 'logs' | 'metrics' | 'traces' | 'unknown';

/**
 * Interface for computed feature generators.
 * Each generator is responsible for producing a specific type of computed feature.
 */
export interface ComputedFeatureGenerator {
  /**
   * Unique type identifier for this computed feature.
   */
  type: string;

  /**
   * Human-readable description of what this feature represents.
   */
  description: string;

  /**
   * Instructions for the LLM on how to use this computed feature.
   * This is automatically included in prompts so the LLM knows how to leverage this feature.
   */
  llmInstructions: string;

  /**
   * Optional list of stream data types this generator applies to.
   * When omitted, the generator runs for all stream types.
   */
  applicableStreamTypes?: StreamDataType[];

  /**
   * Generates the computed value for this feature.
   */
  generate: (options: ComputedFeatureGeneratorOptions) => Promise<Record<string, unknown>>;
}
