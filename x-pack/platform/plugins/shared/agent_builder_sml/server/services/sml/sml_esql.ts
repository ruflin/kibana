/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  EsqlQueryRequest,
  QueryDslQueryContainer,
} from '@elastic/elasticsearch/lib/api/types';
import type { ComposerQuery } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { isEsqlUnknownIndexError } from '@kbn/storage-adapter';

/** One row of an ES|QL response, keyed by column name. */
export type SmlEsqlRow = Record<string, unknown>;

/**
 * Runs a composed ES|QL query against the SML index and returns the rows keyed by column name.
 *
 * `filter` is a Query DSL filter applied beside the query. Terms on `flattened` fields (the
 * ingestion method lives in a flattened `metadata` object) and on the normalized `type` keyword
 * stay in it, since ES|QL cannot read flattened sub-fields.
 *
 * A missing index is a 400 `Unknown index` in ES|QL, where the DSL calls used `ignore_unavailable`
 * and matched nothing: it yields no rows here.
 */
export const runSmlEsql = async ({
  esClient,
  query,
  filter,
}: {
  esClient: ElasticsearchClient;
  query: ComposerQuery;
  filter?: QueryDslQueryContainer;
}): Promise<SmlEsqlRow[]> => {
  const { query: esqlQuery, params } = query.toRequest();
  try {
    const response = (await esClient.esql.query({
      query: esqlQuery,
      ...(params ? { params } : {}),
      ...(filter ? { filter } : {}),
    } as unknown as EsqlQueryRequest)) as unknown as {
      columns: Array<{ name: string }>;
      values: unknown[][];
    };
    const names = response.columns.map((column) => column.name);
    return response.values.map((row) =>
      Object.fromEntries(names.map((name, index) => [name, row[index]]))
    );
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) return [];
    throw error;
  }
};
