/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import type { IndicesStatsIndicesStats } from '@elastic/elasticsearch/lib/api/types';
import { esql } from '@elastic/esql';
import { kqlQuery } from '@kbn/observability-plugin/server';
import type { ProfilingESClient } from '@kbn/profiling-data-access-plugin/server';
import { universalProfilingEventsIndices } from './get_indices_stats';

export function getEstimatedSizeForDocumentsInIndex({
  allIndicesStats,
  indexName,
  numberOfDocs,
}: {
  allIndicesStats: Record<string, IndicesStatsIndicesStats>;
  indexName: string;
  numberOfDocs: number;
}) {
  const indexStats = allIndicesStats[indexName];
  const indexTotalSize = indexStats?.total?.store?.size_in_bytes ?? 0;
  const indexTotalDocCount = indexStats?.total?.docs?.count;

  const estimatedSize = indexTotalDocCount
    ? (numberOfDocs / indexTotalDocCount) * indexTotalSize
    : 0;

  return estimatedSize;
}

export async function getDailyDataGenerationSize({
  client,
  timeFrom,
  timeTo,
  allIndicesStats,
  kuery,
}: {
  client: ProfilingESClient;
  timeFrom: number;
  timeTo: number;
  allIndicesStats?: Record<string, IndicesStatsIndicesStats>;
  kuery: string;
}) {
  // The KQL and the `epoch_second` range stay in the Query DSL `filter`. `kqlQuery` returns an
  // array of clauses, so they are spread into a `bool` filter (the previous DSL body spread the
  // array into an object, which is not a valid query for a non-empty `kuery`).
  const response = await client.esql(
    'profiling_indices_size',
    esql.from(
      [
        ...universalProfilingEventsIndices,
        'profiling-stacktraces',
        'profiling-hosts',
        'profiling-metrics',
      ],
      ['_index']
    ).pipe`STATS number_of_documents = COUNT(*) BY _index`.limit(1000),
    {
      bool: {
        filter: [
          ...kqlQuery(kuery),
          {
            range: {
              '@timestamp': {
                gte: String(timeFrom),
                lt: String(timeTo),
                format: 'epoch_second',
              },
            },
          },
        ],
      },
    }
  );

  const indexColumn = response.columns.findIndex(({ name }) => name === '_index');
  const countColumn = response.columns.findIndex(({ name }) => name === 'number_of_documents');
  const estimatedIncrementalSize = allIndicesStats
    ? response.values.reduce((prev, row) => {
        const numberOfDocs = row[countColumn];
        return (
          prev +
          getEstimatedSizeForDocumentsInIndex({
            allIndicesStats,
            indexName: String(row[indexColumn]),
            numberOfDocs: typeof numberOfDocs === 'number' ? numberOfDocs : 0,
          })
        );
      }, 0)
    : 0;

  const durationAsDays = (timeTo - timeFrom) / 60 / 60 / 24;

  return { dailyDataGenerationBytes: estimatedIncrementalSize / durationAsDays };
}
