/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { esql } from '@elastic/esql';

import { esqlRows, runEsqlRead } from '../services/esql_read';

const AGENT_LOGS_INDEX_PATTERN = 'logs-elastic_agent-*';
const MAX_MESSAGE_COUNT = 100;

export interface AgentPanicLogsData {
  agent_logs_panics_last_hour: Array<{ message: string; timestamp: string }>;
}

const DEFAULT_LOGS_DATA = {
  agent_logs_panics_last_hour: [],
};

export async function getPanicLogsLastHour(
  esClient?: ElasticsearchClient
): Promise<AgentPanicLogsData> {
  if (!esClient) {
    return DEFAULT_LOGS_DATA;
  }

  // No agent log index yet means no panic logs, as the wildcard search without matches did.
  const res = await runEsqlRead({
    esClient,
    query: esql.from([AGENT_LOGS_INDEX_PATTERN])
      .where`@timestamp >= NOW() - 1 hour AND MATCH(message, ${{ text: 'panic' }})`
      .pipe`SORT @timestamp DESC NULLS LAST`
      .keep('message', '@timestamp')
      .limit(MAX_MESSAGE_COUNT),
    ignoreUnknownIndex: true,
  });

  const panicLogsLastHour = esqlRows(res).map((row) => ({
    message: (row.message as string | null) || '',
    timestamp: (row['@timestamp'] as string | null) || '',
  }));

  return {
    agent_logs_panics_last_hour: panicLogsLastHour,
  };
}
