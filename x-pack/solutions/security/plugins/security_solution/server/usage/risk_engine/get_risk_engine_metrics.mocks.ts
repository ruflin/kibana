/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import type { EsqlEsqlResult, IndicesStatsResponse } from '@elastic/elasticsearch/lib/api/types';

export const getAggregationResultMock = ({
  user,
  host,
}: {
  user: number;
  host: number;
}): EsqlEsqlResult => ({
  columns: [
    { name: 'user_name', type: 'long' },
    { name: 'host_name', type: 'long' },
  ],
  values: [[user, host]],
});

export const getStatsResultMock = ({ size }: { size: number }): IndicesStatsResponse => ({
  _shards: { total: 2, successful: 1, failed: 0 },
  _all: {
    primaries: {
      docs: { count: 200000, deleted: 0, total_size_in_bytes: 2 },
      shard_stats: { total_count: 1 },
      store: {
        size_in_bytes: size,
        total_data_set_size_in_bytes: size,
        reserved_in_bytes: 0,
      },
    },
  },
});
