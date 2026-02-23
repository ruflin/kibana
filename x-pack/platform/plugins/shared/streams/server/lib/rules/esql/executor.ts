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
import type { EsqlRuleInstanceState, EsqlRuleParams } from './types';

/**
 * Extracts the log message from a source document, preferring OTel `body.text` over ECS `message`.
 */
export function extractPatternText(source: Record<string, unknown>): string | undefined {
  const body = source.body;
  const bodyText =
    typeof source['body.text'] === 'string'
      ? source['body.text']
      : typeof body === 'object' && body !== null && 'text' in body
        ? (body as Record<string, unknown>).text
        : undefined;

  if (typeof bodyText === 'string') {
    return bodyText;
  }

  const message = source.message;
  if (typeof message === 'string') {
    return message;
  }

  return undefined;
}

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

    const source = result._source as Record<string, unknown>;
    const patternText = extractPatternText(source);

    return {
      _id: alertDocId,
      _source: {
        'stream.name': params.streamName,
        ...(patternText !== undefined ? { pattern_text: patternText } : {}),
        original_source: {
          _id: result._id,
          ...source,
        },
      },
    };
  });

  const { createdAlerts, errors } = await alertWithPersistence(
    alerts,
    // keep refresh false to optimize performance as we don't need to read these alerts back immediately
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
