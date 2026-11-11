/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { rangeQuery } from '@kbn/observability-plugin/server';
import datemath from '@kbn/datemath';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { boolFilter, getTopValues } from '../../../lib/helpers/esql_apm';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';
import { METRICSET_NAME } from '../../../../common/es_fields/apm';

export async function getAgentConfigEtagMetrics(apmEventClient: APMEventClient, etag?: string) {
  return getTopValues({
    apmEventClient,
    operationName: 'get_agent_config_etag_metrics',
    apm: {
      events: [ProcessorEvent.metric],
    },
    field: 'labels.etag',
    size: 200,
    where: [
      [METRICSET_NAME, 'agent_config'],
      ...(etag ? ([['labels.etag', etag]] as Array<[string, string]>) : []),
    ],
    filter: boolFilter(
      ...rangeQuery(datemath.parse('now-15m')!.valueOf(), datemath.parse('now')!.valueOf())
    ),
  });
}
