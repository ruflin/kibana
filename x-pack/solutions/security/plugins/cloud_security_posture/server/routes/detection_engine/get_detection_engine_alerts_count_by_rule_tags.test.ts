/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, httpServiceMock } from '@kbn/core/server/mocks';
import type { CspRouter } from '../../types';
import {
  defineGetDetectionEngineAlertsStatus,
  getDetectionEngineAlertsCountByRuleTags,
} from './get_detection_engine_alerts_count_by_rule_tags';

describe('detection engine alerts status request validation', () => {
  it('accepts rule tags up to the alerting limit of 512 characters and rejects longer tags', () => {
    const httpService = httpServiceMock.createSetupContract();
    const router = httpService.createRouter();

    defineGetDetectionEngineAlertsStatus(router as unknown as CspRouter);

    const route = router.versioned.get.mock.results[0].value;
    const routeDefinition = route.addVersion.mock.calls[0][0];
    const querySchema = routeDefinition.validate.request.query;

    expect(() => querySchema.validate({ tags: ['a'.repeat(512)] })).not.toThrow();
    expect(() => querySchema.validate({ tags: ['a'.repeat(513)] })).toThrow();
  });
});

describe('getDetectionEngineAlertsCountByRuleTags', () => {
  it('counts alerts with ES|QL and keeps the multi-valued tag terms in the request filter', async () => {
    const esClient = elasticsearchServiceMock.createElasticsearchClient();
    esClient.esql.query.mockResolvedValue({
      columns: [{ name: 'total', type: 'long' }],
      values: [[12345]],
    });

    const total = await getDetectionEngineAlertsCountByRuleTags(esClient, ['CIS']);

    expect(esClient.esql.query).toHaveBeenCalledWith({
      query: 'FROM .alerts-security.alerts-default | STATS total = COUNT(*)',
      filter: {
        bool: {
          filter: [
            { term: { 'kibana.alert.rule.tags': 'Cloud Security' } },
            { term: { 'kibana.alert.rule.tags': 'CIS' } },
          ],
        },
      },
    });
    expect(total).toBe(12345);
  });
});
