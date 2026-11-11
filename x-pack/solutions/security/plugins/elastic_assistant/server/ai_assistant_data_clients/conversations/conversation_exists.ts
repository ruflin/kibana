/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { runEsql } from '../../lib/esql_read';

/**
 * Checks if a conversation exists by ID without user access filtering
 */
export const conversationExists = async ({
  esClient,
  logger,
  conversationIndex,
  id,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
  conversationIndex: string;
  id: string;
}): Promise<boolean> => {
  try {
    const response = await runEsql({
      esClient,
      query: esql.from([conversationIndex], ['_id']).pipe`WHERE _id == ${{ id }}`.limit(1),
      ignoreUnknownIndex: true,
    });
    return (response?.values.length ?? 0) > 0;
  } catch (err) {
    logger.error(`Error checking if conversation exists: ${err} with id: ${id}`);
    return false;
  }
};
