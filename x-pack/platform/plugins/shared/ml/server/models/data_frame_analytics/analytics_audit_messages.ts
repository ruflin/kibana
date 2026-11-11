/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { IScopedClusterClient } from '@kbn/core/server';
import type { JobMessage } from '@kbn/ml-common-types/audit_message';
import { ML_NOTIFICATION_INDEX_PATTERN } from '../../../common/constants/index_patterns';
import type { MLSavedObjectService } from '../../saved_objects';
import { esqlRows, runEsql } from '../../lib/esql/esql_read';

const SIZE = 50;

export function analyticsAuditMessagesProvider(
  { asInternalUser }: IScopedClusterClient,
  mlSavedObjectService: MLSavedObjectService
) {
  // search for audit messages,
  // analyticsId is optional. without it, all analytics will be listed.
  async function getAnalyticsAuditMessages(analyticsId: string) {
    let query = esql.from([ML_NOTIFICATION_INDEX_PATTERN], ['_source'])
      .pipe`WHERE (level IS NULL OR level != "activity") AND job_type == "data_frame_analytics"`;

    // if no analyticsId specified, load all of the messages
    if (analyticsId !== undefined) {
      // empty job_id catches system messages, otherwise messages for the specified analyticsId
      query = query.pipe`WHERE job_id == "" OR job_id == ${{ analyticsId }}`;
    }

    const response = await runEsql({
      esClient: asInternalUser,
      query: query.pipe`SORT timestamp DESC NULLS LAST, job_id ASC NULLS LAST`
        .keep('_source')
        .limit(SIZE),
      emptyOnUnknownIndex: true,
    });

    const messages = esqlRows(response).map((row) => row._source as JobMessage);
    messages.reverse();
    return mlSavedObjectService.filterJobsForSpace<JobMessage>(
      'data-frame-analytics',
      messages,
      'job_id'
    );
  }

  return {
    getAnalyticsAuditMessages,
  };
}
