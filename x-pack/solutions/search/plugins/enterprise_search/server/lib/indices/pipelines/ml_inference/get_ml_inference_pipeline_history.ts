/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';

import type { MlInferenceHistoryResponse } from '../../../../../common/types/pipelines';
import {
  esqlRows,
  isEsqlUnknownColumnException,
  runEsql,
  toEsqlSource,
} from '../../../../utils/esql_helpers';

export const fetchMlInferencePipelineHistory = async (
  client: ElasticsearchClient,
  index: string
): Promise<MlInferenceHistoryResponse> => {
  let response;
  try {
    response = await runEsql(
      client,
      esql.from([toEsqlSource(index)]).pipe`STATS doc_count = COUNT(*) BY pipeline = ${esql.col(
        '_ingest.processors.pipeline.enum'
      )}`.pipe`SORT doc_count DESC, pipeline ASC`.limit(100)
    );
  } catch (error) {
    // An index that never ran an ingest pipeline does not map the field: no history.
    if (isEsqlUnknownColumnException(error)) {
      return { history: [] };
    }
    throw error;
  }

  return {
    history: esqlRows(response).flatMap(({ pipeline, doc_count: docCount }) =>
      pipeline === null || pipeline === undefined
        ? []
        : [{ doc_count: docCount as number, pipeline: pipeline as string }]
    ),
  };
};
