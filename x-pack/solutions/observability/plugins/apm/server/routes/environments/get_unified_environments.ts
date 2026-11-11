/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { uniq } from 'lodash';
import { esql } from '@elastic/esql';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { APMIndices } from '@kbn/apm-sources-access-plugin/server';
import { rangeQuery } from '@kbn/observability-plugin/server';
import { ENVIRONMENT_NOT_DEFINED } from '../../../common/environment_filter_values';
import type { Environment } from '../../../common/environment_rt';
import { esqlRows, runEsqlRead } from '../../lib/helpers/esql_read';

const toStrings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === 'string'
  );

/**
 * Returns environments for a service across both APM-processed and unprocessed
 * OTel data without mixing them. For a given service name a service is either
 * one or the other, so the two should-branches naturally return data from only
 * one source. Environments are read from both `service.environment` and the OTel
 * `deployment.environment.name` resource attribute (semconv >= 1.27).
 */
export async function getUnifiedEnvironments({
  esClient,
  indices,
  serviceName,
  start,
  end,
  size,
}: {
  esClient: ElasticsearchClient;
  indices: APMIndices;
  serviceName: string;
  start: number;
  end: number;
  size: number;
}): Promise<Environment[]> {
  const index = [indices.transaction, indices.span].filter(Boolean).join(',');
  if (!index) return [];

  // One row: the distinct values of both environment fields and the number of documents with
  // neither. The DSL `terms` aggregations returned the first `size` keys in ascending order.
  // Unmapped fields read as null: the OTel fields are not mapped in the APM-only indices.
  const response = await runEsqlRead({
    esClient,
    query: esql.from(index.split(',')).addSetCommand('unmapped_fields', 'nullify')
      .pipe`WHERE service.name == ${{ serviceName }}`
      .pipe`WHERE processor.event == "transaction" OR (kind IN ("Server", "Consumer") AND processor.event IS NULL)`
      .pipe`STATS environments = VALUES(service.environment), otel_environments = VALUES(resource.attributes.deployment.environment.name), missing_environments = COUNT(*) WHERE service.environment IS NULL AND resource.attributes.deployment.environment.name IS NULL`,
    filter: { bool: { filter: rangeQuery(start, end) } },
  });

  const row = esqlRows(response)[0];
  if (!row) return [];

  const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const topKeys = (value: unknown) => toStrings(value).sort(byKey).slice(0, size);

  const environments = uniq([
    ...topKeys(row.environments),
    ...topKeys(row.otel_environments),
  ]).sort() as Environment[];

  if (Number(row.missing_environments) > 0) {
    environments.push(ENVIRONMENT_NOT_DEFINED.value as Environment);
  }

  return environments;
}
