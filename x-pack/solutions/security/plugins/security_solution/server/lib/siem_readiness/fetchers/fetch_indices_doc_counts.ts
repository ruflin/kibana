/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { IndexDocCount } from '@kbn/siem-readiness';
import { esql } from '@elastic/esql';
import { esqlRows, isPlainEsqlSource, runEsqlRead, toCount } from '../../../utils/esql/esql_read';

export const fetchIndicesDocCounts = async ({
  esClient,
  indices,
}: {
  esClient: ElasticsearchClient;
  indices: string[];
}): Promise<IndexDocCount[]> => {
  return Promise.all(
    indices.map(async (index) => {
      // `index` comes from the request body, and the composer does not escape source names: a name
      // with `|` or a newline would be run as ES|QL. The count API rejected such a name as well.
      if (!isPlainEsqlSource(index)) {
        return { index, docCount: 0, exists: false, error: 'Invalid index name or pattern' };
      }
      try {
        // An index that does not exist is an error in ES|QL, where the count API with
        // `ignore_unavailable` returned 0 for it, and `runEsqlRead` turns it back into no rows.
        const response = await runEsqlRead({
          esClient,
          query: esql.from([index]).pipe`STATS total = COUNT(*)`,
        });

        return { index, docCount: toCount(esqlRows(response)[0]?.total), exists: true };
      } catch (error: unknown) {
        const esError = error as { meta?: { statusCode?: number }; message?: string };
        return {
          index,
          docCount: 0,
          exists: false,
          error: esError.meta?.statusCode === 404 ? undefined : esError.message,
        };
      }
    })
  );
};
