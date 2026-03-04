/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { BaseFeature } from '@kbn/streams-schema';
import { datasetAnalysisGenerator } from './dataset_analysis';
import { errorLogsGenerator } from './error_logs';
import { logPatternsGenerator } from './log_patterns';
import { logSamplesGenerator } from './log_samples';
import { metricSamplesGenerator } from './metric_samples';
import { traceSamplesGenerator } from './trace_samples';
import type {
  ComputedFeatureGenerator,
  ComputedFeatureGeneratorOptions,
  StreamDataType,
} from './types';

/**
 * Internal registry for computed feature generators.
 * Ensures each feature type is unique.
 */
class ComputedFeatureRegistry {
  private generators = new Map<string, ComputedFeatureGenerator>();

  register(generator: ComputedFeatureGenerator): void {
    if (this.generators.has(generator.type)) {
      throw new Error(`Computed feature type "${generator.type}" is already registered`);
    }
    this.generators.set(generator.type, generator);
  }

  getAll(): ComputedFeatureGenerator[] {
    return Array.from(this.generators.values());
  }
}

/**
 * Internal registry instance.
 *
 * To add a new computed feature:
 * 1. Create a new file in this folder implementing ComputedFeatureGenerator
 * 2. Import and add your generator to the array below
 */
const registry = new ComputedFeatureRegistry();

const generators: ComputedFeatureGenerator[] = [
  datasetAnalysisGenerator,
  logSamplesGenerator,
  logPatternsGenerator,
  errorLogsGenerator,
  metricSamplesGenerator,
  traceSamplesGenerator,
];

generators.forEach((generator) => registry.register(generator));

/**
 * Derives the stream data type from the stream name prefix.
 */
function getStreamDataType(streamName: string): StreamDataType {
  if (streamName.startsWith('logs')) return 'logs';
  if (streamName.startsWith('metrics')) return 'metrics';
  if (streamName.startsWith('traces')) return 'traces';
  return 'unknown';
}

/**
 * Returns formatted LLM instructions for all computed feature types.
 * This is automatically included in prompts so the LLM knows how to use each feature type.
 */
export function getComputedFeatureInstructions(): string {
  return registry
    .getAll()
    .map((generator) => `**${generator.type}**: ${generator.llmInstructions}`)
    .join('\n\n');
}

/**
 * Converts a generator and its computed value into a BaseFeature.
 */
function toComputedFeature(
  generator: ComputedFeatureGenerator,
  value: Record<string, unknown>,
  streamName: string
): BaseFeature {
  return {
    id: generator.type,
    stream_name: streamName,
    description: generator.description,
    type: generator.type,
    properties: value,
    confidence: 100,
  };
}

/**
 * Generates all computed features by running all applicable generators in parallel.
 * Generators with `applicableStreamTypes` are only run when the stream name matches
 * one of the specified types. Generators without `applicableStreamTypes` run for all streams.
 */
export async function generateAllComputedFeatures(
  options: ComputedFeatureGeneratorOptions
): Promise<BaseFeature[]> {
  const streamDataType = getStreamDataType(options.stream.name);
  const applicableGenerators = registry.getAll().filter((generator) => {
    if (!generator.applicableStreamTypes) return true;
    return generator.applicableStreamTypes.includes(streamDataType);
  });

  return Promise.all(
    applicableGenerators.map(async (generator) => {
      const value = await generator.generate(options);
      return toComputedFeature(generator, value, options.stream.name);
    })
  );
}
