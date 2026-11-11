/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { type ElasticsearchClient } from '@kbn/core/server';
import { esql } from '@elastic/esql';

import { AGENT_POLICY_INDEX } from '../../../common';

import { esqlRows, runEsqlRead } from '../../services/esql_read';

import type { Context, PoliciesRevisionSummaries } from './types';

export const getPoliciesToClean = async (esClient: ElasticsearchClient, context: Context) => {
  const {
    config: { maxRevisions },
  } = context;
  const rows = await queryMaxRevisionsAndCounts(esClient, context);
  return rows.reduce<PoliciesRevisionSummaries>((acc, row) => {
    if (row.docCount > maxRevisions) {
      acc[row.policyId] = {
        maxRevision: row.latestRevision,
        count: row.docCount,
      };
    }
    return acc;
  }, {});
};

const queryMaxRevisionsAndCounts = async (esClient: ElasticsearchClient, context: Context) => {
  const response = await runEsqlRead({
    esClient,
    query: esql.from([AGENT_POLICY_INDEX])
      .pipe`STATS doc_count = COUNT(*), latest_revision = MAX(revision_idx) BY policy_id`
      .pipe`SORT doc_count DESC, policy_id ASC`.limit(context.config.maxPolicies),
    ignoreUnknownIndex: true,
    signal: context.signal,
  });
  return esqlRows(response).map((row) => ({
    policyId: row.policy_id as string,
    docCount: row.doc_count as number,
    latestRevision: row.latest_revision as number,
  }));
};
