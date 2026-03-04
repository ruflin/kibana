/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getSampleDocuments } from '@kbn/ai-tools';
import { TRACE_SAMPLES_FEATURE_TYPE } from '@kbn/streams-schema';
import type { ComputedFeatureGenerator } from './types';

const SAMPLE_SIZE = 5;

export const traceSamplesGenerator: ComputedFeatureGenerator = {
  type: TRACE_SAMPLES_FEATURE_TYPE,

  applicableStreamTypes: ['traces'],

  description: 'Raw sample trace/span documents from the stream',

  llmInstructions: `Contains raw sample trace and span documents from the stream.
Use the \`properties.samples\` array to see actual span entries and their field values.
Trace documents typically contain span identifiers (e.g. \`span.id\`, \`trace.id\`, \`parent.id\`),
operation names (e.g. \`span.name\`, \`name\`), status codes (e.g. \`span.status.code\`, \`otel.status_code\`),
duration measurements (e.g. \`span.duration.us\`, \`duration\`), and resource attributes
(e.g. \`service.name\`, \`host.name\`).
This is useful for understanding the shape of trace data, identifying error spans, latency patterns,
and service dependency relationships in the stream.`,

  generate: async ({ stream, start, end, esClient }) => {
    const { hits } = await getSampleDocuments({
      esClient,
      index: stream.name,
      start,
      end,
      size: SAMPLE_SIZE,
    });

    const samples = hits.map((hit) => hit.fields ?? {});

    return {
      samples,
    };
  },
};
