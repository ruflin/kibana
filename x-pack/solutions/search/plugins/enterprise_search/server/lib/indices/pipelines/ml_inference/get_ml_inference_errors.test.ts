/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { ElasticsearchClient } from '@kbn/core/server';

import { getMlInferenceErrors } from './get_ml_inference_errors';

describe('getMlInferenceErrors', () => {
  const indexName = 'my-index';

  const mockClient = {
    esql: { query: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch aggregations and transform them', async () => {
    mockClient.esql.query.mockImplementation(() =>
      Promise.resolve({
        columns: [
          { name: 'doc_count', type: 'long' },
          { name: 'max_error_timestamp', type: 'date' },
          { name: 'message', type: 'keyword' },
        ],
        values: [
          [100, '2022-10-05T13:50:36.100Z', 'Error message 1'],
          [200, '2022-10-05T13:50:36.200Z', 'Error message 2'],
        ],
      })
    );

    const actualResult = await getMlInferenceErrors(
      indexName,
      mockClient as unknown as ElasticsearchClient
    );

    expect(actualResult).toEqual([
      {
        message: 'Error message 1',
        doc_count: 100,
        timestamp: '2022-10-05T13:50:36.100Z',
      },
      {
        message: 'Error message 2',
        doc_count: 200,
        timestamp: '2022-10-05T13:50:36.200Z',
      },
    ]);
    expect(mockClient.esql.query).toHaveBeenCalledTimes(1);
    expect(mockClient.esql.query).toHaveBeenCalledWith({
      query: `FROM ${indexName} | STATS doc_count = COUNT(*), max_error_timestamp = MAX(\`_ingest.inference_errors.timestamp\`) BY message = \`_ingest.inference_errors.message.enum\` | SORT max_error_timestamp DESC | LIMIT 20`,
    });
  });

  it('should return an empty array if there are no aggregates', async () => {
    // The index maps no inference error fields: ES|QL fails on the unknown column.
    mockClient.esql.query.mockRejectedValue(
      new errors.ResponseError({
        statusCode: 400,
        body: {
          error: {
            type: 'verification_exception',
            reason:
              'Found 1 problem\nline 1:1: Unknown column [_ingest.inference_errors.timestamp]',
          },
        },
        headers: {},
        meta: {} as never,
        warnings: [],
      })
    );

    const actualResult = await getMlInferenceErrors(
      indexName,
      mockClient as unknown as ElasticsearchClient
    );

    expect(actualResult).toEqual([]);
  });
});
