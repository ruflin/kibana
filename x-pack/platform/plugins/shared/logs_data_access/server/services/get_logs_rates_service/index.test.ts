/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { ElasticsearchClient } from '@kbn/core/server';
import { createGetLogsRatesService } from '.';

const timeFrom = 0;
const timeTo = 60_000;

const createEsClient = (query: jest.Mock) =>
  ({ esql: { query } } as unknown as ElasticsearchClient);

const run = (query: jest.Mock) =>
  createGetLogsRatesService()({
    esClient: createEsClient(query),
    identifyingMetadata: 'service.name',
    serviceNames: ['api', 'web'],
    timeFrom,
    timeTo,
  });

describe('createGetLogsRatesService', () => {
  it('counts logs and errors per service with the clauses as a request filter', async () => {
    const query = jest.fn().mockResolvedValue({
      columns: [
        { name: 'log_count', type: 'long' },
        { name: 'error_count', type: 'long' },
        { name: 'upper_error_count', type: 'long' },
        { name: 'service', type: 'keyword' },
        { name: 'log_error_count', type: 'long' },
      ],
      values: [
        [100, 10, 5, 'api', 10],
        [50, 0, 0, 'web', 0],
      ],
    });

    const result = await run(query);

    expect(result).toEqual({
      api: { logRatePerMinute: 100, logErrorRate: 0.1 },
      web: { logRatePerMinute: 50, logErrorRate: null },
    });
    const [request] = query.mock.calls[0];
    expect(request.query).toBe(
      'FROM logs-*-* | STATS log_count = COUNT(*), error_count = COUNT(*) WHERE log.level == "error", upper_error_count = COUNT(*) WHERE log.level == "ERROR" BY service = service.name | EVAL log_error_count = GREATEST(error_count, upper_error_count) | SORT log_count DESC, service ASC | LIMIT 10'
    );
    expect(request.filter.bool.filter).toEqual([
      { exists: { field: 'log.level' } },
      { terms: { 'service.name': ['api', 'web'] } },
      { range: { '@timestamp': { gte: timeFrom, lte: timeTo, format: 'epoch_millis' } } },
    ]);
  });

  it('returns no services when no log index exists', async () => {
    const query = jest.fn().mockRejectedValue(
      new errors.ResponseError({
        statusCode: 400,
        body: {
          error: { type: 'verification_exception', reason: 'line 1:6: Unknown index [logs-*-*]' },
        },
        headers: {},
        warnings: [],
        meta: {} as never,
      })
    );

    await expect(run(query)).resolves.toEqual({});
  });
});
