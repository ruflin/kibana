/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import { AGENT_ID } from '../../../common/es_fields';
import { hasDocuments } from '../../lib/esql';

export async function getHasLogs(esClient: ElasticsearchClient, agentId: string) {
  try {
    return await hasDocuments({
      esClient,
      indices: ['logs-*', 'metrics-*', 'logs.*'],
      terms: [{ field: AGENT_ID, value: agentId }],
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return false;
    }

    const errorType = error?.meta?.body?.error?.type;
    const rootCauseType = error?.meta?.body?.error?.root_cause?.[0]?.type;

    if (
      errorType === 'search_phase_execution_exception' &&
      rootCauseType === 'no_shard_available_action_exception'
    ) {
      return false;
    }

    throw error;
  }
}
