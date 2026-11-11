/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { TracedElasticsearchClient } from '@kbn/traced-es-client';
import { getSlosForEntity } from './get_slos_for_entity';

describe('getSlosForEntity', () => {
  const createClient = (esql: jest.Mock) => ({ esql } as unknown as TracedElasticsearchClient);

  const params = {
    start: 1000,
    end: 2000,
    entity: { 'service.name': 'checkout' },
    sloSummaryIndices: '.slo-observability.summary-v3*',
    size: 5,
    spaceId: 'default',
  };

  it('reads the summaries with ES|QL and keeps the KQL on the groupings in the request filter', async () => {
    const esql = jest.fn().mockResolvedValue({
      hits: [{ _id: 'summary-1', _source: { status: 'VIOLATED' } }],
    });

    const result = await getSlosForEntity({ ...params, esClient: createClient(esql) });

    const [operationName, request, options] = esql.mock.calls[0];
    expect(operationName).toBe('get_slo_summaries_for_entity');
    expect(request.query).toBe(
      'FROM .slo-observability.summary-v3* METADATA _id, _source | WHERE slo.createdAt <= TO_DATETIME(?end) AND summaryUpdatedAt >= TO_DATETIME(?start) AND spaceId == ?spaceId | LIMIT 5'
    );
    expect(request.params).toEqual([{ end: 2000 }, { start: 1000 }, { spaceId: 'default' }]);
    expect(JSON.stringify(request.filter)).toContain('slo.groupings.service.name');
    expect(options).toEqual({ transform: 'plain' });
    expect(result).toEqual({
      hits: { hits: [{ _id: 'summary-1', _source: { status: 'VIOLATED' } }] },
    });
  });

  it('returns no hits when no summary index matches', async () => {
    const esql = jest.fn().mockRejectedValue({
      statusCode: 400,
      body: { error: { type: 'verification_exception', reason: 'Unknown index [nope*]' } },
    });

    const result = await getSlosForEntity({ ...params, esClient: createClient(esql) });

    expect(result).toEqual({ hits: { hits: [] } });
  });
});
