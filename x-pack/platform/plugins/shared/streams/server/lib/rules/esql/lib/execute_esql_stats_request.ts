/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { ESQLSearchResponse } from '@kbn/es-types';
import { createTaskRunError, TaskErrorSource } from '@kbn/task-manager-plugin/server';

export interface StatsRow {
  columns: Array<{ name: string; type: string }>;
  values: Record<string, unknown>;
}

export type StatsResponse = StatsRow[];

export const executeEsqlStatsRequest = async ({
  esClient,
  esqlRequest,
  logger,
}: {
  esClient: ElasticsearchClient;
  esqlRequest: { query: string; filter: estypes.QueryDslQueryContainer };
  logger: Logger;
}): Promise<StatsResponse> => {
  try {
    const response = (await esClient.esql.query({
      query: esqlRequest.query,
      filter: esqlRequest.filter,
      drop_null_columns: true,
    })) as unknown as ESQLSearchResponse;

    const { columns, values } = response;

    if (!columns || columns.length === 0 || !values || values.length === 0) {
      return [];
    }

    return values.map((row) => {
      const rowValues: Record<string, unknown> = {};
      columns.forEach((col, idx) => {
        rowValues[col.name] = row[idx];
      });
      return { columns, values: rowValues };
    });
  } catch (error) {
    const message = `Error executing ES|QL STATS request: ${
      error instanceof Error ? error.message : String(error)
    }`;
    logger.debug(message);
    throw createTaskRunError(new Error(message), TaskErrorSource.USER);
  }
};
