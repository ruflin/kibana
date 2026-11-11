/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import { ATTACK_DISCOVERY_EVENT_SERVICE_ACCOUNT_TAG } from '@kbn/discoveries';

import { ATTACK_DISCOVERY_EVENT_PROVIDER } from '../../../../../common/constants';
import { runEsql } from '../../../esql_read';

/**
 * Returns true when a generation in the space was written by a service account (e.g. an
 * AlertZero Worker), so its Attack discoveries belong to no single user
 */
export const isServiceAccountGeneration = async ({
  esClient,
  eventLogIndex,
  executionUuid,
  spaceId,
}: {
  esClient: ElasticsearchClient;
  eventLogIndex: string;
  executionUuid: string;
  spaceId: string;
}): Promise<boolean> => {
  const response = await runEsql({
    esClient,
    query: esql.from([eventLogIndex]).pipe`WHERE event.provider == ${{
      provider: ATTACK_DISCOVERY_EVENT_PROVIDER,
    }} AND kibana.alert.rule.execution.uuid == ${{ executionUuid }}`.limit(1),
    // `kibana.space_ids` and `tags` are multi-valued, so they stay in the request filter
    filter: {
      bool: {
        filter: [
          { term: { 'kibana.space_ids': spaceId } },
          { term: { tags: ATTACK_DISCOVERY_EVENT_SERVICE_ACCOUNT_TAG } },
        ],
      },
    },
    ignoreUnknownIndex: true,
  });

  return (response?.values.length ?? 0) > 0;
};
