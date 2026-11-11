/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { kqlQuery, rangeQuery } from '@kbn/observability-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { SERVICE_NAME } from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import { esqlTermsBuckets, topTermsQuery, whereTerm } from '../../lib/helpers/esql_values';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';

export type MobileTermsByFieldResponse = Array<{
  label: string;
  count: number;
}>;

export async function getMobileTermsByField({
  kuery,
  apmEventClient,
  serviceName,
  environment,
  start,
  end,
  size,
  fieldName,
}: {
  kuery: string;
  apmEventClient: APMEventClient;
  serviceName: string;
  environment: string;
  start: number;
  end: number;
  size: number;
  fieldName: string;
}): Promise<MobileTermsByFieldResponse> {
  const response = await apmEventClient.esql(`get_mobile_terms_by_${fieldName}`, {
    apm: {
      events: [ProcessorEvent.transaction],
    },
    // The field is not mapped in every index, so unmapped fields read as null.
    query: (index) =>
      topTermsQuery(
        whereTerm(
          esql.from(index).addSetCommand('unmapped_fields', 'nullify'),
          SERVICE_NAME,
          serviceName
        ),
        fieldName,
        size
      ),
    filter: {
      bool: {
        filter: [...rangeQuery(start, end), ...environmentQuery(environment), ...kqlQuery(kuery)],
      },
    },
  });

  return esqlTermsBuckets(response, fieldName, size).buckets.map(({ key, doc_count: count }) => ({
    label: key as string,
    count,
  }));
}
