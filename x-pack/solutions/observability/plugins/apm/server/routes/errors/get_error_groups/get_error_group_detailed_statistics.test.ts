/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { APMEventClient } from '../../../lib/helpers/create_es_client/create_apm_event_client';
import { esqlResponse, toEsqlRequest } from '../../../utils/esql_test_helpers';
import { getErrorGroupDetailedStatistics } from './get_error_group_detailed_statistics';

describe('getErrorGroupDetailedStatistics', () => {
  const start = 1_700_000_040_000;
  const end = start + 10 * 60_000;

  it('counts the errors of each group per bucket, filling the buckets without errors', async () => {
    const esql = jest.fn().mockResolvedValue(
      esqlResponse(
        ['doc_count', 'error.grouping_key', 'bucket'],
        [
          [2, 'g1', start],
          [5, 'g2', start + 60_000],
        ]
      )
    );

    const result = await getErrorGroupDetailedStatistics({
      kuery: '',
      serviceName: 'svc',
      apmEventClient: { esql } as unknown as APMEventClient,
      numBuckets: 10,
      groupIds: ['g1', 'g2'],
      environment: 'production',
      start,
      end,
    });

    expect(result.map(({ groupId }) => groupId)).toEqual(['g2', 'g1']);
    expect(result[0].timeseries.slice(0, 3)).toEqual([
      { x: start, y: 0 },
      { x: start + 60_000, y: 5 },
      { x: start + 120_000, y: 0 },
    ]);
    const { query, params } = toEsqlRequest(esql.mock.calls[0][1]);
    expect(query).toContain('WHERE `error.grouping_key` IN (?error_grouping_key_values)');
    expect(query).toContain('STATS doc_count = COUNT(*) BY `error.grouping_key`, bucket');
    expect(params).toEqual(
      expect.arrayContaining([{ error_grouping_key_values: ['g1', 'g2'] }, { intervalMs: 60_000 }])
    );
  });
});
