/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';

import type { MlInferenceError } from '../../../../../common/types/pipelines';
import {
  esqlRows,
  isEsqlUnknownColumnException,
  runEsql,
  toEsqlSource,
} from '../../../../utils/esql_helpers';

/**
 * Fetches an aggregate of distinct ML inference errors from the target index, along with the most
 * recent error's timestamp and affected document count for each bucket.
 * @param indexName the index to get the errors from.
 * @param esClient the Elasticsearch Client to use to fetch the errors.
 */
export const getMlInferenceErrors = async (
  indexName: string,
  esClient: ElasticsearchClient
): Promise<MlInferenceError[]> => {
  let response;
  try {
    response = await runEsql(
      esClient,
      esql.from([toEsqlSource(indexName)])
        .pipe`STATS doc_count = COUNT(*), max_error_timestamp = MAX(${esql.col(
        '_ingest.inference_errors.timestamp'
      )}) BY message = ${esql.col('_ingest.inference_errors.message.enum')}`
        .pipe`SORT max_error_timestamp DESC`.limit(20)
    );
  } catch (error) {
    // An index that never ran an inference processor maps neither field: no errors.
    if (isEsqlUnknownColumnException(error)) {
      return [];
    }
    throw error;
  }

  return esqlRows(response).flatMap(({ message, doc_count: docCount, max_error_timestamp }) =>
    message === null || message === undefined
      ? []
      : [
          {
            message: message as string,
            doc_count: docCount as number,
            timestamp: (max_error_timestamp as string | null) ?? undefined,
          },
        ]
  );
};
