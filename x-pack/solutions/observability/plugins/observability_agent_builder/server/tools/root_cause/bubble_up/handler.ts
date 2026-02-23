/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { diffCountHandler, type DiffCountResult } from '../diff_count/handler';

interface BubbleUpParams {
  index: string;
  timeField: string;
  start: string;
  end: string;
  slowExpression: string;
  attributeFields: string[];
  riskThreshold: number;
  significanceThreshold: number;
  limit: number;
}

export interface BubbleUpResult {
  attribute: string;
  items: DiffCountResult[];
}

/**
 * Runs diff_count for each attribute field separately, using the slow expression
 * as the test partition. This finds which attribute values are over-represented
 * in the "slow" or "bad" set compared to the overall population.
 */
export async function bubbleUpHandler({
  esClient,
  logger,
  params,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
  params: BubbleUpParams;
}): Promise<{ results: BubbleUpResult[] }> {
  const results: BubbleUpResult[] = [];

  for (const attr of params.attributeFields) {
    const { results: diffResults } = await diffCountHandler({
      esClient,
      logger,
      params: {
        index: params.index,
        timeField: params.timeField,
        start: params.start,
        end: params.end,
        testExpression: params.slowExpression,
        byFields: [attr],
        direction: 'both',
        riskThreshold: params.riskThreshold,
        significanceThreshold: params.significanceThreshold,
        limit: params.limit,
      },
    });

    if (diffResults.length > 0) {
      results.push({ attribute: attr, items: diffResults });
    }
  }

  return { results };
}
