/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { type ElasticsearchClient } from '@kbn/core/server';
import { esql } from '@elastic/esql';

import { AGENTS_INDEX } from '../../../common';

import { esqlRows, runEsqlRead } from '../../services/esql_read';

import type { Context, PoliciesRevisionSummaries } from './types';

export const populateMinimumRevisionsUsedByAgents = async (
  esClient: ElasticsearchClient,
  policiesRevisionSummaries: PoliciesRevisionSummaries,
  context: Context
) => {
  const rows = await queryMinimumRevisionsUsedByAgents(
    esClient,
    Object.keys(policiesRevisionSummaries),
    context
  );

  rows.forEach((row) => {
    const policySummary = policiesRevisionSummaries[row.policyId];
    if (policySummary) {
      policySummary.minUsedRevision = row.minUsedRevision;
    }
  });

  return policiesRevisionSummaries;
};

const queryMinimumRevisionsUsedByAgents = async (
  esClient: ElasticsearchClient,
  policyIds: string[],
  context: Context
) => {
  const response = await runEsqlRead({
    esClient,
    query: esql.from([AGENTS_INDEX]).where`policy_id IN (${{ policyIds }}) AND active == true`
      .pipe`STATS min_used_revision = MIN(policy_revision_idx) BY policy_id`.limit(
      context.config.maxPolicies
    ),
    ignoreUnknownIndex: true,
    signal: context.signal,
  });
  return esqlRows(response).map((row) => ({
    policyId: row.policy_id as string,
    minUsedRevision: row.min_used_revision as number,
  }));
};
