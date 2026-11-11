/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';

import { AGENTS_INDEX } from '../../../common';
import { esqlRows, runEsqlRead, wherePolicyBaseIdsWithFallback } from '../esql_read';

/**
 * Given a list of Agent Policy IDs, an array will be returned with
 * the ids of the agents using that agent policy.
 * @param esClient
 * @param agentPolicyIds
 */
export const getAgentIdsForAgentPolicies = async (
  esClient: ElasticsearchClient,
  agentPolicyIds: string[]
): Promise<string[]> => {
  if (agentPolicyIds.length === 0) {
    return [];
  }

  // Agents on `<id>#sentinel` or a version specific policy count for the base policy
  const response = await runEsqlRead({
    esClient,
    query: wherePolicyBaseIdsWithFallback(esql.from([AGENTS_INDEX], ['_id']), agentPolicyIds)
      .keep('_id')
      .limit(100), // TODO: check if reasonable value
    ignoreUnknownIndex: true,
  });

  return esqlRows(response).map((row) => row._id as string);
};
