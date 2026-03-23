/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { QueryClient } from '../../../lib/streams/assets/query/query_client';
import type { StreamsClient } from '../../../lib/streams/client';
import { validateEsqlQueryForStreamOrThrow } from '../../../lib/significant_events/validate_esql_query';

export interface WriteQueryKnowledgeIndicatorParams {
  stream_name: string;
  query_id: string;
  title: string;
  description: string;
  esql: { query: string };
  severity_score?: number;
  evidence?: string[];
}

export interface WriteQueryKnowledgeIndicatorOutput {
  acknowledged: boolean;
}

export async function writeQueryKnowledgeIndicatorHandler({
  streamsClient,
  queryClient,
  logger,
  params,
}: {
  streamsClient: StreamsClient;
  queryClient: QueryClient;
  logger: Logger;
  params: WriteQueryKnowledgeIndicatorParams;
}): Promise<WriteQueryKnowledgeIndicatorOutput> {
  const { stream_name: streamName, query_id: queryId, ...queryFields } = params;

  const definition = await streamsClient.getStream(streamName);

  validateEsqlQueryForStreamOrThrow({
    esqlQuery: queryFields.esql.query,
    stream: definition,
  });

  await queryClient.upsert(definition, {
    id: queryId,
    title: queryFields.title,
    description: queryFields.description,
    esql: queryFields.esql,
    severity_score: queryFields.severity_score,
    evidence: queryFields.evidence,
  });

  logger.debug(
    `write_query_knowledge_indicator: upserted query ${queryId} on stream ${streamName}`
  );

  return { acknowledged: true };
}
