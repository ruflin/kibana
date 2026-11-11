/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ComposerQuery } from '@elastic/esql';
import type { MlClient } from '../../lib/ml_client';
import { resultsServiceProvider } from './results_service';

const createMlClient = (rows: Array<Record<string, unknown>> = []) => {
  const anomalyEsql = jest.fn(async (_query: ComposerQuery, _jobIds: string[]) => rows);
  const getJobs = jest.fn();
  return { anomalyEsql, getJobs, mlClient: { anomalyEsql, getJobs } as unknown as MlClient };
};

describe('resultsServiceProvider - ES|QL reads', () => {
  it('getMaxAnomalyScore filters bucket results by time and job ID', async () => {
    const { anomalyEsql, mlClient } = createMlClient([{ maxScore: 87.5 }]);

    const result = await resultsServiceProvider(mlClient).getMaxAnomalyScore(['job-1'], 1000, 2000);

    expect(result).toEqual({ maxScore: 87.5 });
    const [query, jobIds] = anomalyEsql.mock.calls[0];
    expect(query.toRequest()).toEqual({
      query:
        'FROM .ml-anomalies-* | WHERE result_type == "bucket" AND timestamp >= TO_DATETIME(?earliestMs) AND timestamp <= TO_DATETIME(?latestMs) | WHERE job_id IN (?jobIds) | STATS maxScore = MAX(anomaly_score)',
      params: [{ earliestMs: 1000 }, { latestMs: 2000 }, { jobIds: ['job-1'] }],
    });
    expect(jobIds).toEqual(['job-1']);
  });

  it('getMaxAnomalyScore returns null when nothing matches', async () => {
    const { mlClient } = createMlClient([{ maxScore: null }]);

    expect(await resultsServiceProvider(mlClient).getMaxAnomalyScore([], 1, 2)).toEqual({
      maxScore: null,
    });
  });

  it('getLatestBucketTimestampByJob returns epoch milliseconds by job ID', async () => {
    const { anomalyEsql, mlClient } = createMlClient([
      { job_id: 'job-1', maxTimestamp: '2024-01-01T00:00:00.000Z' },
      { job_id: 'job-2', maxTimestamp: null },
    ]);

    const result = await resultsServiceProvider(mlClient).getLatestBucketTimestampByJob([]);

    expect(result).toEqual({ 'job-1': Date.parse('2024-01-01T00:00:00.000Z'), 'job-2': undefined });
    expect(anomalyEsql.mock.calls[0][0].toRequest().query).toBe(
      'FROM .ml-anomalies-* | WHERE result_type == "bucket" | STATS maxTimestamp = MAX(timestamp) BY job_id | LIMIT 10000'
    );
  });

  it('getCategoryExamples caps the examples per category', async () => {
    const { anomalyEsql, mlClient } = createMlClient([
      { category_id: 1, examples: ['a', 'b', 'c'] },
      { category_id: 2, examples: 'single' },
    ]);

    const result = await resultsServiceProvider(mlClient).getCategoryExamples(
      'job-1',
      ['1', '2'],
      2
    );

    expect(result).toEqual({ '1': ['a', 'b'], '2': ['single'] });
    expect(anomalyEsql.mock.calls[0][0].toRequest()).toEqual({
      query:
        'FROM .ml-anomalies-* | WHERE job_id == ?jobId AND (category_id IN (?ids)) | KEEP category_id, examples | LIMIT 500',
      params: [{ jobId: 'job-1' }, { ids: [1, 2] }],
    });
  });

  it('getCategoryDefinition returns the empty definition when the category is missing', async () => {
    const { mlClient } = createMlClient([]);

    expect(await resultsServiceProvider(mlClient).getCategoryDefinition('job-1', '7')).toEqual({
      categoryId: '7',
      terms: null,
      regex: null,
      examples: [],
    });
  });

  it('getCategoryStoppedPartitions groups the stopped partitions by job', async () => {
    const { anomalyEsql, getJobs, mlClient } = createMlClient([
      { job_id: 'job-1', partition_field_value: 'p1' },
      { job_id: 'job-1', partition_field_value: 'p2' },
    ]);
    getJobs.mockResolvedValue({
      jobs: [
        {
          job_id: 'job-1',
          analysis_config: { per_partition_categorization: { stop_on_warn: true } },
        },
        { job_id: 'job-2', analysis_config: {} },
      ],
    });

    const result = await resultsServiceProvider(mlClient).getCategoryStoppedPartitions([
      'job-1',
      'job-2',
    ]);

    expect(result).toEqual({ jobs: { 'job-1': ['p1', 'p2'] } });
    expect(anomalyEsql.mock.calls[0][0].toRequest().query).toBe(
      'FROM .ml-anomalies-* | WHERE result_type == "categorizer_stats" AND categorization_status == "warn" AND (job_id IN (?jobIdsWithStopOnWarnSet)) | WHERE partition_field_value IS NOT NULL | STATS stopped = COUNT(*) BY job_id, partition_field_value | LIMIT 10000'
    );
  });
});
