/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { rangeQuery } from '@kbn/observability-plugin/server';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { APMIndices } from '@kbn/apm-sources-access-plugin/server';
import { KIND } from '@kbn/apm-types/es_fields';
import type { ServiceSchemaType } from '@kbn/apm-types';
import { PROCESSOR_EVENT } from '../../../common/es_fields/apm';
import { environmentQuery } from '../../../common/utils/environment_query';
import { esqlRows, runEsqlRead } from '../../lib/helpers/esql_read';

export async function getServiceSchemaType({
  esClient,
  indices,
  serviceName,
  environment,
  start,
  end,
}: {
  esClient: ElasticsearchClient;
  indices: APMIndices;
  serviceName: string;
  environment: string;
  start: number;
  end: number;
}): Promise<{ schema: ServiceSchemaType }> {
  // Combine transaction and span indices — users may configure them differently,
  // and OTel services may only have data in the span index.
  const index = [...new Set([indices.transaction, indices.span].flatMap((i) => i.split(',')))]
    .filter(Boolean)
    .join(',');
  if (!index) return { schema: 'unknown' };

  // The ES|QL query only needs the service name; the range and environment stay in the request
  // `filter` because they are Query DSL helpers shared with the rest of the plugin.
  const filter = {
    bool: { filter: [...rangeQuery(start, end), ...environmentQuery(environment)] },
  };
  const sources = index.split(',');

  // `processor.event` and `kind` are mapped in only some of the indices, so unmapped fields are
  // read as null instead of failing the query.
  const exists = async (field: string) => {
    const response = await runEsqlRead({
      esClient,
      query: esql.from(sources).addSetCommand('unmapped_fields', 'nullify')
        .pipe`WHERE service.name == ${{ serviceName }} AND ${esql.dpar(field)} IS NOT NULL`.limit(
        1
      ),
      filter,
    });
    return esqlRows(response).length > 0;
  };

  const [hasEcs, hasOtel] = await Promise.all([exists(PROCESSOR_EVENT), exists(KIND)]);

  if (hasEcs) return { schema: 'ecs' };
  if (hasOtel) return { schema: 'otel' };
  return { schema: 'unknown' };
}
