/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import { getAlerts } from './get_alerts';

describe('getAlerts', () => {
  const esClient = elasticsearchServiceMock.createClusterClient().asInternalUser;
  const logger = loggingSystemMock.createLogger();

  it('counts the last 24 hours of alerts per rule uuid, capped at maxSize', async () => {
    esClient.esql.query.mockResponseOnce({
      columns: [
        { name: 'doc_count', type: 'long' },
        { name: 'rule_uuid', type: 'keyword' },
      ],
      values: [
        [3, 'rule-a'],
        [1, 'rule-b'],
        [9, null],
      ],
    });

    const buckets = await getAlerts({
      esClient,
      signalsIndex: '.alerts-security.alerts-default*',
      maxSize: 10000,
      maxPerPage: 1000,
      logger,
    });

    expect(buckets).toEqual([
      { key: { detectionAlerts: 'rule-a' }, doc_count: 3 },
      { key: { detectionAlerts: 'rule-b' }, doc_count: 1 },
    ]);
    expect(esClient.esql.query.mock.calls[0][0]).toMatchObject({
      query:
        'FROM .alerts-security.alerts-default* | WHERE @timestamp >= NOW() - 24 hours AND @timestamp <= NOW() | STATS doc_count = COUNT(*) BY rule_uuid = kibana.alert.rule.uuid | WHERE rule_uuid IS NOT NULL | SORT rule_uuid ASC | LIMIT 10000',
    });
  });
});
