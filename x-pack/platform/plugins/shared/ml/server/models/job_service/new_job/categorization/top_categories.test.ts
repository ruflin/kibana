/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ComposerQuery } from '@elastic/esql';
import type { MlClient } from '../../../../lib/ml_client';
import { topCategoriesProvider } from './top_categories';

describe('topCategoriesProvider', () => {
  it('counts the categories, then loads their definitions as _source', async () => {
    const queries: ComposerQuery[] = [];
    const responses = [
      [
        { by_field_value: '2', doc_count: 10 },
        { by_field_value: '1', doc_count: 4 },
      ],
      [{ _source: { category_id: 1 } }, { _source: { category_id: 2 } }],
      [{ total: 12 }],
    ];
    const anomalyEsql = jest.fn(async (query: ComposerQuery) => {
      queries.push(query);
      return responses.shift() ?? [];
    });

    const result = await topCategoriesProvider({
      anomalyEsql,
    } as unknown as MlClient).topCategories('job-1', 2);

    expect(result).toEqual({
      total: 12,
      categories: [
        { count: 10, category: { category_id: 2 } },
        { count: 4, category: { category_id: 1 } },
      ],
    });
    expect(queries.map((q) => q.toRequest().query)).toEqual([
      'FROM .ml-anomalies-* | WHERE job_id == ?jobId AND result_type == "model_plot" AND by_field_name == "mlcategory" AND by_field_value IS NOT NULL | STATS doc_count = COUNT(*) BY by_field_value | SORT doc_count DESC, by_field_value ASC | LIMIT 2',
      'FROM .ml-anomalies-* METADATA _source | WHERE job_id == ?jobId AND (category_id IN (?ids)) | KEEP _source | LIMIT 2',
      'FROM .ml-anomalies-* | WHERE job_id == ?jobId AND category_id IS NOT NULL | STATS total = COUNT(*)',
    ]);
  });
});
