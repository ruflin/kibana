/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import { esqlRows, runEsqlRead, toCount } from '../../../utils/esql/esql_read';
import type { AggregationBucket } from './type';

// For telemetry we need to query the concrete entity-store index pattern, instead of the alias.
export const ENTITY_INDEX = '.entities.v2.latest.*';

/**
 * The most recently written values of a keyword field of the entity store, with their document
 * count and last write time, newest first. The buckets have the shape of a `terms` aggregation
 * ordered by its `max(@timestamp)`, which is what the collectors parse.
 */
export const getFieldTermsStats = async (
  esClient: ElasticsearchClient,
  termsField: string,
  size: number = 10,
  index: string = ENTITY_INDEX
): Promise<AggregationBucket[]> => {
  const response = await runEsqlRead({
    esClient,
    query: esql.from([index]).pipe`STATS doc_count = COUNT(*), last_doc_timestamp = MAX(@timestamp)
        BY field_value = ${esql.col(termsField.split('.'))}`.pipe`WHERE field_value IS NOT NULL`
      .pipe`SORT last_doc_timestamp DESC NULLS LAST`.limit(size),
  });

  return esqlRows(response).flatMap((row) =>
    typeof row.field_value === 'string' && typeof row.last_doc_timestamp === 'string'
      ? [
          {
            key: row.field_value,
            doc_count: toCount(row.doc_count),
            last_doc_timestamp: {
              value: Date.parse(row.last_doc_timestamp),
              value_as_string: row.last_doc_timestamp,
            },
          },
        ]
      : []
  );
};
