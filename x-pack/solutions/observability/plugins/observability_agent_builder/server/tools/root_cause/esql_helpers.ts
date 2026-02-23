/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import type { EsqlEsqlColumnInfo, FieldValue } from '@elastic/elasticsearch/lib/api/types';

export interface EsqlResult {
  columns: EsqlEsqlColumnInfo[];
  values: FieldValue[][];
}

export async function runEsql({
  esClient,
  query,
}: {
  esClient: ElasticsearchClient;
  query: string;
}): Promise<EsqlResult> {
  const response = await esClient.esql.query({ query, drop_null_columns: true });
  return {
    columns: response.columns,
    values: response.values,
  };
}

/**
 * Attempts to run an ES|QL query that uses proposed commands (Phase 2).
 * Returns the result if successful, or null if the command is not supported.
 */
export async function tryPhase2Esql({
  esClient,
  query,
}: {
  esClient: ElasticsearchClient;
  query: string;
}): Promise<EsqlResult | null> {
  try {
    return await runEsql({ esClient, query });
  } catch (error) {
    const message = error?.message ?? '';
    const isUnsupportedCommand =
      message.includes('Unknown command') ||
      message.includes('line') ||
      message.includes('parsing_exception');
    if (isUnsupportedCommand) {
      return null;
    }
    throw error;
  }
}
