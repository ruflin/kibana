/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { rangeQuery } from '@kbn/observability-plugin/server';
import { accessKnownApmEventFields } from '@kbn/apm-data-access-plugin/server/utils';
import { asMutableArray } from '../../../../common/utils/as_mutable_array';
import { maybe } from '../../../../common/utils/maybe';
import { ApmDocumentType } from '../../../../common/document_type';
import {
  boolFilter,
  esqlRowsAsHits,
  fromApmIndex,
  keepFields,
} from '../../../lib/helpers/esql_apm';
import {
  EVENT_OUTCOME,
  SPAN_DESTINATION_SERVICE_RESOURCE,
  TRACE_ID,
} from '../../../../common/es_fields/apm';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';
import { RollupInterval } from '../../../../common/rollup';

export async function getDownstreamServiceResource({
  traceId,
  start,
  end,
  apmEventClient,
}: {
  traceId: string;
  start: number;
  end: number;
  apmEventClient: APMEventClient;
}) {
  const requiredFields = asMutableArray([SPAN_DESTINATION_SERVICE_RESOURCE] as const);
  const response = await apmEventClient.esql('get_error_group_main_statistics', {
    apm: {
      sources: [
        {
          documentType: ApmDocumentType.SpanEvent,
          rollupInterval: RollupInterval.None,
        },
      ],
    },
    query: (index) =>
      keepFields(
        fromApmIndex(index).pipe`WHERE ${esql.col(TRACE_ID)} == ${{ traceId }}`
          .pipe`WHERE ${esql.col(EVENT_OUTCOME)} == ${{ outcome: 'failure' }}`
          .pipe`WHERE ${esql.col(SPAN_DESTINATION_SERVICE_RESOURCE)} IS NOT NULL`,
        [...requiredFields]
      ).limit(1),
    filter: boolFilter(...rangeQuery(start, end)),
  });

  const fields = maybe(esqlRowsAsHits(response)[0])?.fields;

  const event = fields && accessKnownApmEventFields(fields).requireFields(requiredFields);

  return event?.[SPAN_DESTINATION_SERVICE_RESOURCE];
}
