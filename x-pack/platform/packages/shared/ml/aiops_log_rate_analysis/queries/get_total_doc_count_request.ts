/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import { esql } from '@elastic/esql';

import type { AiopsLogRateAnalysisSchema } from '../api/schema';

import { getQueryWithParams } from './get_query_with_params';

// An index name is interpolated into the ES|QL `FROM` command, so only characters that can
// appear in an index name, an index pattern, a date math expression or a remote cluster
// prefix are accepted.
const INDEX_NAME_PATTERN = /^[\w.\-*:+<>{}/%,]+$/;

export const getTotalDocCountRequest = (params: AiopsLogRateAnalysisSchema): EsqlQueryRequest => {
  if (!INDEX_NAME_PATTERN.test(params.index)) {
    throw new Error(`Invalid index name or pattern: ${params.index}`);
  }

  const { query, params: queryParams } = esql.from(params.index.split(','))
    .pipe`STATS total = COUNT(*)`.toRequest();

  return {
    query,
    ...(queryParams ? { params: queryParams } : {}),
    // The search query and the time range stay Query DSL, they are applied as the request filter.
    filter: getQueryWithParams({ params }),
    ...(params.projectRouting ? { project_routing: params.projectRouting } : {}),
  } as EsqlQueryRequest;
};
