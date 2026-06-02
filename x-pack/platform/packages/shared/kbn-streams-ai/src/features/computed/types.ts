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
  /**
   * ES|QL source to read documents from (comma-separated when multiple).
   * Derived from the stream definition via `getSourcesForStream`: ingest
   * streams resolve to their data-stream index patterns, query streams to
   * their ES|QL view (e.g. `$.foobar`). Generators must use this instead of
   * `stream.name`, which is not a valid index for query streams.
   */
  source: string;
  /**
   * How to read documents from `source`. `'view'` for query streams (ES|QL
   * views), which expose no `_id`/`_source` metadata, so samplers must
   * reconstruct documents from columns rather than reading `_source`.
   */
  metadataMode: 'index' | 'view';
  start: number;
  end: number;
  esClient: ElasticsearchClient;
  logger: Logger;
}

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
   * Generates the computed value for this feature.
   */
  generate: (options: ComputedFeatureGeneratorOptions) => Promise<Record<string, unknown>>;
}
