/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { errors } from '@elastic/elasticsearch';
import type { ElasticsearchClient } from '@kbn/core/server';

import type { MlInferenceHistoryResponse } from '../../../../../common/types/pipelines';

import { fetchMlInferencePipelineHistory } from './get_ml_inference_pipeline_history';

const COLUMNS = [
  { name: 'doc_count', type: 'long' },
  { name: 'pipeline', type: 'keyword' },
];
const emptyMockResponse = { columns: COLUMNS, values: [] };
const listMockResponse = {
  columns: COLUMNS,
  values: [
    [20, 'ml-inference-test-001'],
    [33, 'ml-inference-test-002'],
  ],
};
const reorderedMockResponse = {
  columns: [COLUMNS[1], COLUMNS[0]],
  values: [
    ['ml-inference-test-001', 20],
    ['ml-inference-test-002', 33],
  ],
};

const expectedMockResults: MlInferenceHistoryResponse = {
  history: [
    {
      doc_count: 20,
      pipeline: 'ml-inference-test-001',
    },
    {
      doc_count: 33,
      pipeline: 'ml-inference-test-002',
    },
  ],
};

describe('fetchMlInferencePipelineHistory', () => {
  const mockClient = {
    esql: { query: jest.fn() },
  };
  const client = mockClient as unknown as ElasticsearchClient;
  const indexName = 'unit-test-index';
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should query ingest pipelines from documents', async () => {
    mockClient.esql.query.mockResolvedValue(emptyMockResponse);

    await fetchMlInferencePipelineHistory(client, indexName);
    expect(mockClient.esql.query).toHaveBeenCalledWith({
      query: `FROM ${indexName} | STATS doc_count = COUNT(*) BY pipeline = \`_ingest.processors.pipeline.enum\` | SORT doc_count DESC, pipeline ASC | LIMIT 100`,
    });
  });
  it('should return empty history when no results found', async () => {
    mockClient.esql.query.mockResolvedValue(emptyMockResponse);

    const response = await fetchMlInferencePipelineHistory(client, indexName);
    expect(response).toEqual({ history: [] });
  });
  it('should return empty history when no aggregations returned', async () => {
    // The index maps no pipeline field: ES|QL fails on the unknown column.
    mockClient.esql.query.mockRejectedValue(
      new errors.ResponseError({
        statusCode: 400,
        body: {
          error: {
            type: 'verification_exception',
            reason: 'Found 1 problem\nline 1:1: Unknown column [_ingest.processors.pipeline.enum]',
          },
        },
        headers: {},
        meta: {} as never,
        warnings: [],
      })
    );

    const response = await fetchMlInferencePipelineHistory(client, indexName);
    expect(response).toEqual({ history: [] });
  });
  it('should return history with aggregated list', async () => {
    mockClient.esql.query.mockResolvedValue(listMockResponse);

    const response = await fetchMlInferencePipelineHistory(client, indexName);
    expect(response).toEqual(expectedMockResults);
  });
  it('should return history with aggregated object', async () => {
    mockClient.esql.query.mockResolvedValue(reorderedMockResponse);

    const response = await fetchMlInferencePipelineHistory(client, indexName);
    expect(response).toEqual(expectedMockResults);
  });
});
