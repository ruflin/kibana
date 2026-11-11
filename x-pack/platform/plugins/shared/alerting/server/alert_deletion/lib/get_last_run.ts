/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { KibanaRequest } from '@kbn/core/server';
import type { AlertDeletionContext } from '../alert_deletion_client';
import { runEsqlRows } from '../../lib/esql_read';
import { EVENT_LOG_ACTIONS, EVENT_LOG_PROVIDER } from '../../plugin';

export const getLastRun = async (context: AlertDeletionContext, req: KibanaRequest) => {
  const esClient = await context.elasticsearchClientPromise;
  const spacesService = await context.spacesService;
  const currentSpaceId = spacesService ? spacesService.getSpaceId(req) : 'default';

  try {
    // `kibana.space_ids` holds several values, so its term stays Query DSL in the request filter.
    const [row] = await runEsqlRows({
      esClient,
      filter: { term: { 'kibana.space_ids': currentSpaceId } },
      query: esql.from(['.kibana-event-log*']).pipe`WHERE event.action == ${{
        action: EVENT_LOG_ACTIONS.deleteAlerts,
      }} AND event.provider == ${{
        provider: EVENT_LOG_PROVIDER,
      }}`.pipe`SORT @timestamp DESC NULLS LAST`
        .limit(1)
        .keep('@timestamp'),
    });

    if (row) {
      return row['@timestamp'] as string | undefined;
    }
  } catch (err) {
    context.logger.error(`Error getting last run date: ${err.message}`);
  }
};
