/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { SERVICE_NAME } from '../../../../common/es_fields/apm';
import { AGENT_NAME } from '../../../../common/es_fields/apm';
import { esqlRows } from '../../../lib/helpers/esql_read';
import { fromApmIndex, keepFields } from '../../../lib/helpers/esql_apm';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';

export async function getAgentNameByService({
  serviceName,
  apmEventClient,
}: {
  serviceName: string;
  apmEventClient: APMEventClient;
}) {
  const response = await apmEventClient.esql('get_agent_name_by_service', {
    apm: {
      events: [ProcessorEvent.transaction, ProcessorEvent.error, ProcessorEvent.metric],
    },
    // One document is enough to name the agent
    query: (index) =>
      keepFields(
        fromApmIndex(index).pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ serviceName }}`
          .pipe`WHERE ${esql.col(AGENT_NAME)} IS NOT NULL`,
        [AGENT_NAME]
      ).limit(1),
  });

  return esqlRows(response)[0]?.[AGENT_NAME] as string | undefined;
}
