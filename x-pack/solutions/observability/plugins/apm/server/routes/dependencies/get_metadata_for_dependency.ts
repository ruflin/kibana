/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { rangeQuery } from '@kbn/observability-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { accessKnownApmEventFields } from '@kbn/apm-data-access-plugin/server/utils';
import type { MetadataForDependencyResponse } from '@kbn/apm-api-shared';
import { asMutableArray } from '../../../common/utils/as_mutable_array';
import { maybe } from '../../../common/utils/maybe';
import {
  SPAN_DESTINATION_SERVICE_RESOURCE,
  SPAN_SUBTYPE,
  SPAN_TYPE,
} from '../../../common/es_fields/apm';
import { boolFilter, esqlRowsAsHits, fromApmIndex, keepFields } from '../../lib/helpers/esql_apm';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';

export async function getMetadataForDependency({
  apmEventClient,
  dependencyName,
  start,
  end,
}: {
  apmEventClient: APMEventClient;
  dependencyName: string;
  start: number;
  end: number;
}): Promise<MetadataForDependencyResponse> {
  const fields = asMutableArray([SPAN_TYPE, SPAN_SUBTYPE] as const);
  const sampleResponse = await apmEventClient.esql('get_metadata_for_dependency', {
    apm: {
      events: [ProcessorEvent.span, ProcessorEvent.transaction],
    },
    query: (index) =>
      keepFields(
        fromApmIndex(index).pipe`WHERE ${esql.col(SPAN_DESTINATION_SERVICE_RESOURCE)} == ${{
          dependencyName,
        }}`.pipe`SORT @timestamp DESC NULLS LAST`,
        [...fields]
      ).limit(1),
    filter: boolFilter(...rangeQuery(start, end)),
  });

  const hitFields = maybe(esqlRowsAsHits(sampleResponse)[0])?.fields;

  const sample = hitFields && accessKnownApmEventFields(hitFields);

  return {
    spanType: sample?.[SPAN_TYPE],
    spanSubtype: sample?.[SPAN_SUBTYPE],
  };
}
