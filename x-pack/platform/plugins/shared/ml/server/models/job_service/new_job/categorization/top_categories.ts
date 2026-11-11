/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';

import type { CategoryId, Category } from '@kbn/ml-common-types/categories';
import type { MlClient } from '../../../../lib/ml_client';
import { ML_RESULTS_INDEX_PATTERN } from '../../../../../common/constants/index_patterns';

export function topCategoriesProvider(mlClient: MlClient) {
  async function getTotalCategories(jobId: string): Promise<number> {
    const rows = await mlClient.anomalyEsql(
      esql.from([ML_RESULTS_INDEX_PATTERN]).pipe`WHERE job_id == ${{
        jobId,
      }} AND category_id IS NOT NULL`.pipe`STATS total = COUNT(*)`,
      [jobId]
    );
    const total = rows[0]?.total;
    return typeof total === 'number' ? total : 0;
  }

  async function getTopCategoryCounts(jobId: string, numberOfCategories: number) {
    const rows = await mlClient.anomalyEsql(
      esql.from([ML_RESULTS_INDEX_PATTERN]).pipe`WHERE job_id == ${{
        jobId,
      }} AND result_type == "model_plot" AND by_field_name == "mlcategory" AND by_field_value IS NOT NULL`
        .pipe`STATS doc_count = COUNT(*) BY by_field_value`
        .pipe`SORT doc_count DESC, by_field_value ASC`.limit(numberOfCategories),
      [jobId]
    );

    const catCounts = rows.map((row) => ({
      id: row.by_field_value as CategoryId,
      count: row.doc_count as number,
    }));
    return catCounts;
  }

  async function getCategories(
    jobId: string,
    catIds: CategoryId[],
    size: number
  ): Promise<Category[]> {
    const ids = catIds.map(Number);
    const query = esql.from([ML_RESULTS_INDEX_PATTERN], ['_source']);
    const rows = await mlClient.anomalyEsql(
      (catIds.length
        ? query.pipe`WHERE job_id == ${{ jobId }} AND category_id IN (${{ ids }})`
        : query.pipe`WHERE job_id == ${{ jobId }} AND category_id IS NOT NULL`
      )
        .keep('_source')
        .limit(size),
      [jobId]
    );

    return rows.map((row) => row._source as Category);
  }

  async function topCategories(jobId: string, numberOfCategories: number) {
    const catCounts = await getTopCategoryCounts(jobId, numberOfCategories);
    const categories = await getCategories(
      jobId,
      catCounts.map((c) => c.id),
      catCounts.length || numberOfCategories
    );

    const catsById = categories.reduce((p, c) => {
      p[c.category_id] = c;
      return p;
    }, {} as { [id: number]: Category });

    const total = await getTotalCategories(jobId);

    if (catCounts.length) {
      return {
        total,
        categories: catCounts.map(({ id, count }) => {
          return {
            count,
            category: catsById[id] ?? null,
          };
        }),
      };
    } else {
      return {
        total,
        categories: categories.map((category) => {
          return {
            category,
          };
        }),
      };
    }
  }

  return {
    topCategories,
  };
}
