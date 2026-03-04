/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getSampleDocuments } from '@kbn/ai-tools';
import { METRIC_SAMPLES_FEATURE_TYPE } from '@kbn/streams-schema';
import type { ComputedFeatureGenerator } from './types';

const SAMPLE_SIZE = 5;

export const metricSamplesGenerator: ComputedFeatureGenerator = {
  type: METRIC_SAMPLES_FEATURE_TYPE,

  applicableStreamTypes: ['metrics'],

  description: 'Raw sample metric documents from the stream',

  llmInstructions: `Contains raw sample metric documents from the stream.
Use the \`properties.samples\` array to see actual metric data points and their field values.
Metric documents typically contain numeric measurements (e.g. \`system.cpu.usage\`, \`http.server.duration\`),
resource attributes (e.g. \`host.name\`, \`service.name\`), and timestamp fields.
This is useful for understanding the shape of metrics, identifying available numeric fields, and seeing real examples of data in the stream.`,

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
