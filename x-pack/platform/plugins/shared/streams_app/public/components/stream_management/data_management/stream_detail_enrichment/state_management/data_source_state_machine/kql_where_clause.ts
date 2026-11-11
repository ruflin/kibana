/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Filter, Query } from '@kbn/es-query';
import { convertFiltersToESQLExpression, convertQueryToESQLExpression } from '@kbn/esql-utils';
import type { EnrichmentDataSourceWithUIAttributes } from '../../types';

/** The KQL query and filters of a data source as one ES|QL boolean expression, or '' when there are none. */
export function buildKqlWhereClause(dataSource: EnrichmentDataSourceWithUIAttributes): string {
  if (dataSource.type !== 'kql-samples') return '';

  const clauses: string[] = [];

  const queryExpr = convertQueryToESQLExpression(dataSource.query as Query | undefined);
  if (queryExpr) {
    clauses.push(queryExpr);
  }

  if (dataSource.filters && dataSource.filters.length > 0) {
    const { esqlExpression } = convertFiltersToESQLExpression(dataSource.filters as Filter[]);
    if (esqlExpression) {
      clauses.push(esqlExpression);
    }
  }

  return clauses.join(' AND ');
}
