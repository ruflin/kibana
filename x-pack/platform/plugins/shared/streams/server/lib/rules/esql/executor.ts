/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  AlertInstanceContext,
  AlertInstanceState,
  RuleExecutorOptions,
} from '@kbn/alerting-plugin/server';
import type { Alert } from '@kbn/alerts-as-data-utils';
import type { PersistenceServices } from '@kbn/rule-registry-plugin/server';
import { isEmpty } from 'lodash';
import moment from 'moment';
import objectHash from 'object-hash';
import { MAX_ALERTS_PER_EXECUTION } from './common';
import { buildEsqlSearchRequest } from './lib/build_esql_search_request';
import { executeEsqlRequest } from './lib/execute_esql_request';
import { executeEsqlStatsRequest } from './lib/execute_esql_stats_request';
import type { EsqlRuleInstanceState, EsqlRuleParams } from './types';

export async function getRuleExecutor(
  options: RuleExecutorOptions<
    EsqlRuleParams,
    EsqlRuleInstanceState,
    AlertInstanceState,
    AlertInstanceContext,
    'default',
    Alert
  > & {
    services: PersistenceServices;
  }
) {
  const { services, params, logger, state, startedAt, spaceId, rule } = options;
  const { scopedClusterClient, alertWithPersistence } = services;

  const previousOriginalDocumentIds = state.previousOriginalDocumentIds ?? [];

  const now = moment(startedAt);

  const esqlRequest = buildEsqlSearchRequest({
    query: params.query,
    timestampField: params.timestampField,
    from: now.clone().subtract(2, 'minutes').toISOString(),
    to: now.clone().toISOString(),
    previousOriginalDocumentIds,
  });

  if (params.queryType === 'stats') {
    return executeStatsPath({ esqlRequest, services, logger, spaceId, rule });
  }

  return executeRowPath({
    esqlRequest,
    services,
    logger,
    spaceId,
    rule,
    previousOriginalDocumentIds,
  });
}

async function executeRowPath({
  esqlRequest,
  services,
  logger,
  spaceId,
  rule,
  previousOriginalDocumentIds,
}: {
  esqlRequest: { query: string; filter: import('@elastic/elasticsearch').estypes.QueryDslQueryContainer };
  services: PersistenceServices & { scopedClusterClient: { asCurrentUser: import('@kbn/core/server').ElasticsearchClient } };
  logger: import('@kbn/core/server').Logger;
  spaceId: string;
  rule: { id: string };
  previousOriginalDocumentIds: string[];
}) {
  const { scopedClusterClient, alertWithPersistence } = services;

  const results = await executeEsqlRequest({
    esClient: scopedClusterClient.asCurrentUser,
    esqlRequest,
    logger,
  });

  if (results.length === 0) {
    return {
      state: {
        previousOriginalDocumentIds: [],
      },
    };
  }

  const alertDocIdToDocumentIdMap = new Map<string, string>();
  const alerts = results.map((result) => {
    const alertDocId = objectHash([result._id, rule.id, spaceId]);
    alertDocIdToDocumentIdMap.set(alertDocId, result._id);

    return {
      _id: alertDocId,
      _source: {
        original_source: {
          _id: result._id,
          ...result._source,
        },
      },
    };
  });

  const { createdAlerts, errors } = await alertWithPersistence(
    alerts,
    false,
    MAX_ALERTS_PER_EXECUTION
  );

  if (!isEmpty(errors)) {
    logger.debug(() => `Alerts bulk process finished with errors: ${JSON.stringify(errors)}`);
  }

  const originalDocumentIds = createdAlerts.map(
    (alert) => alertDocIdToDocumentIdMap.get(alert._id)!
  );

  return {
    state: {
      previousOriginalDocumentIds: originalDocumentIds,
    },
  };
}

async function executeStatsPath({
  esqlRequest,
  services,
  logger,
  spaceId,
  rule,
}: {
  esqlRequest: { query: string; filter: import('@elastic/elasticsearch').estypes.QueryDslQueryContainer };
  services: PersistenceServices & { scopedClusterClient: { asCurrentUser: import('@kbn/core/server').ElasticsearchClient } };
  logger: import('@kbn/core/server').Logger;
  spaceId: string;
  rule: { id: string };
}) {
  const { scopedClusterClient, alertWithPersistence } = services;

  const statsResults = await executeEsqlStatsRequest({
    esClient: scopedClusterClient.asCurrentUser,
    esqlRequest,
    logger,
  });

  if (statsResults.length === 0) {
    return {
      state: {
        previousOriginalDocumentIds: [],
      },
    };
  }

  const alerts = statsResults.map((row, idx) => {
    const alertDocId = objectHash([JSON.stringify(row.values), rule.id, spaceId, idx]);
    return {
      _id: alertDocId,
      _source: {
        original_source: {
          _id: alertDocId,
          query_type: 'stats' as const,
          stats_result: row.values,
          stats_columns: row.columns.map((c) => c.name),
        },
      },
    };
  });

  const { errors } = await alertWithPersistence(alerts, false, MAX_ALERTS_PER_EXECUTION);

  if (!isEmpty(errors)) {
    logger.debug(() => `STATS alerts bulk process finished with errors: ${JSON.stringify(errors)}`);
  }

  return {
    state: {
      previousOriginalDocumentIds: [],
    },
  };
}
