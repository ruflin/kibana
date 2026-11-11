/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql, type ComposerQuery } from '@elastic/esql';
import type { ESFilter } from '@kbn/es-types';
import { rangeQuery } from '@kbn/observability-plugin/server';
import type { Annotation } from '../../../../common/annotations';
import { AnnotationType } from '../../../../common/annotations';
import { AT_TIMESTAMP, SERVICE_NAME, SERVICE_VERSION } from '../../../../common/es_fields/apm';
import { environmentQuery } from '../../../../common/utils/environment_query';
import {
  getBackwardCompatibleDocumentTypeFilter,
  getProcessorEventForTransactions,
} from '../../../lib/helpers/transactions';
import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlRows } from '../../../lib/helpers/esql_read';
import { toEpochMillis } from '../../../lib/helpers/esql_values';
import { compactMap } from '../../../utils/compact_map';

export async function getDerivedServiceAnnotations({
  apmEventClient,
  serviceName,
  environment,
  searchAggregatedTransactions,
  start,
  end,
}: {
  serviceName: string;
  environment: string;
  apmEventClient: APMEventClient;
  searchAggregatedTransactions: boolean;
  start: number;
  end: number;
}) {
  const events = [getProcessorEventForTransactions(searchAggregatedTransactions)];
  const baseWhere = (query: ComposerQuery) =>
    query.pipe`WHERE ${esql.col(SERVICE_NAME)} == ${{ serviceName }}`;
  const baseFilter: ESFilter[] = [
    ...getBackwardCompatibleDocumentTypeFilter(searchAggregatedTransactions),
    ...environmentQuery(environment),
  ];

  const versionsResponse = await apmEventClient.esql('get_derived_service_annotations', {
    apm: { events },
    query: (index) =>
      baseWhere(esql.from(index)).pipe`STATS doc_count = COUNT(*) BY ${esql.col(SERVICE_VERSION)}`
        .pipe`SORT doc_count DESC, ${esql.col(SERVICE_VERSION)} ASC`.limit(10),
    filter: { bool: { filter: [...baseFilter, ...rangeQuery(start, end)] } },
  });

  const versions = esqlRows(versionsResponse).map((row) => row[SERVICE_VERSION] as string);

  if (versions.length <= 1) {
    return [];
  }

  // The first-seen lookup has no time range: the range is only applied to the result below.
  const firstSeenResponse = await apmEventClient.esql('get_first_seen_of_version', {
    apm: { events },
    query: (index) =>
      baseWhere(esql.from(index)).pipe`WHERE ${esql.col(SERVICE_VERSION)} IN (${{ versions }})`
        .pipe`STATS first_seen = MIN(@timestamp) BY ${esql.col(SERVICE_VERSION)}`.limit(
        versions.length
      ),
    filter: { bool: { filter: baseFilter } },
  });

  const firstSeenByVersion = new Map(
    esqlRows(firstSeenResponse).map((row) => [row[SERVICE_VERSION] as string, row.first_seen])
  );
  const annotations = versions.map(
    (version) => [version, firstSeenByVersion.get(version)] as const
  );

  return compactMap(annotations, ([version, firstSeenTimestamp]) => {
    const firstSeen = toEpochMillis(firstSeenTimestamp);

    if (firstSeen === null) {
      return null;
    }

    if (firstSeen < start || firstSeen > end) {
      return null;
    }

    return {
      type: AnnotationType.VERSION,
      id: `${version}`,
      [AT_TIMESTAMP]: firstSeen,
      text: `${version}`,
    } satisfies Annotation;
  });
}
