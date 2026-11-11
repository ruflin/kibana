/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { rangeQuery } from '@kbn/observability-plugin/server';
import { ProcessorEvent } from '@kbn/observability-plugin/common';
import { SERVICE_NAME } from '../../../common/es_fields/apm';
import { getProcessorEventForTransactions } from '../../lib/helpers/transactions';
import { esqlRows } from '../../lib/helpers/esql_read';
import { whereTerm } from '../../lib/helpers/esql_values';
import type { APMEventClient } from '../../lib/helpers/create_es_client/create_apm_event_client';

/**
 * Returns true when at least one document in range has none of the given fields set.
 * Used by the environment selector to decide whether to offer "Not defined".
 */
export async function hasUnsetValueForFields({
  searchAggregatedTransactions,
  apmEventClient,
  serviceName,
  fieldNames,
  start,
  end,
}: {
  apmEventClient: APMEventClient;
  searchAggregatedTransactions: boolean;
  serviceName: string | undefined;
  fieldNames: readonly string[];
  start: number;
  end: number;
}): Promise<boolean> {
  // The other environment field is not mapped in every index, so unmapped fields read as null.
  const resp = await apmEventClient.esql('has_unset_value_for_fields', {
    apm: {
      events: [
        getProcessorEventForTransactions(searchAggregatedTransactions),
        ProcessorEvent.metric,
        ProcessorEvent.error,
      ],
    },
    query: (index) => {
      // No field to check means every document counts, like an empty `must_not`.
      const unset = fieldNames.map((field) => esql.exp`${esql.col(field)} IS NULL`);
      const scoped = whereTerm(
        esql.from(index).addSetCommand('unmapped_fields', 'nullify'),
        SERVICE_NAME,
        serviceName
      );
      return (
        unset.length > 0
          ? scoped.pipe`WHERE ${unset.reduce((acc, clause) => esql.exp`${acc} AND ${clause}`)}`
          : scoped
      )
        .keep(SERVICE_NAME)
        .limit(1);
    },
    filter: { bool: { filter: rangeQuery(start, end) } },
  });
  return esqlRows(resp).length > 0;
}
