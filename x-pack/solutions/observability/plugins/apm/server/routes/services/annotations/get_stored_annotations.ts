/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import { esql } from '@elastic/esql';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { rangeQuery } from '@kbn/observability-plugin/server';
import type { ScopedAnnotationsClient } from '@kbn/observability-plugin/server';
import { environmentQuery } from '../../../../common/utils/environment_query';
import type { Annotation } from '../../../../common/annotations';
import { AnnotationType } from '../../../../common/annotations';
import { esqlRows, runEsqlRead } from '../../../lib/helpers/esql_read';
import { withApmSpan } from '../../../utils/with_apm_span';

export function getStoredAnnotations({
  serviceName,
  environment,
  client,
  annotationsClient,
  logger,
  start,
  end,
}: {
  serviceName: string;
  environment: string;
  client: ElasticsearchClient;
  annotationsClient: ScopedAnnotationsClient;
  logger: Logger;
  start: number;
  end: number;
}): Promise<Annotation[]> {
  return withApmSpan('get_stored_annotations', async () => {
    // `tags` is multi-valued, so it stays in the request `filter` with the range and environment.
    const filter = {
      bool: {
        filter: [
          { term: { tags: 'apm' } },
          ...rangeQuery(start, end),
          ...environmentQuery(environment),
        ],
      },
    };

    try {
      const response = await runEsqlRead({
        esClient: client,
        query: esql.from(annotationsClient.index.split(','), ['_id'])
          .pipe`WHERE annotation.type == "deployment" AND service.name == ${{ serviceName }}`
          .keep('_id', '@timestamp', 'message')
          .limit(50),
        filter,
      });

      return esqlRows(response).map((row) => {
        return {
          type: AnnotationType.VERSION,
          id: String(row._id),
          '@timestamp': new Date(String(row['@timestamp'])).getTime(),
          text: String(row.message),
        };
      });
    } catch (error) {
      // index is only created when an annotation has been indexed,
      // so we should handle this error gracefully
      if (error instanceof errors.ResponseError) {
        const type = error.body?.error?.type;

        if (type === 'index_not_found_exception') {
          return [];
        }

        if (type === 'security_exception') {
          logger.warn(
            `Unable to get stored annotations due to a security exception. Please make sure that the user has 'indices:data/read/search' permissions for ${annotationsClient.index}`
          );
          return [];
        }
      }

      throw error;
    }
  });
}
