/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import type { MLSavedObjectService } from '../../saved_objects';
import { DEFAULT_ML_PROJECT_ROUTING } from '../../../common/constants/cps';
import { NotificationsService } from './notifications_service_provider';

describe('NotificationsService - countMessages', () => {
  const createService = (serverless = { isServerless: false, cpsEnabled: false }) => {
    const client = elasticsearchServiceMock.createScopedClusterClient();
    client.asInternalUser.esql.query.mockImplementation((async ({ params }: { params: any[] }) =>
      params.some((p) => p.jobType === 'anomaly_detector')
        ? {
            columns: [
              { name: 'count', type: 'long' },
              { name: 'level', type: 'keyword' },
            ],
            values: [
              [3, 'error'],
              [5, 'info'],
            ],
          }
        : { columns: [], values: [] }) as never);
    const savedObjects: Pick<MLSavedObjectService, 'getAnomalyDetectionJobIds'> = {
      getAnomalyDetectionJobIds: jest.fn().mockResolvedValue(['job-1']),
    };
    const service = new NotificationsService(
      client,
      savedObjects as MLSavedObjectService,
      { ad: true, dfa: false, nlp: false },
      serverless
    );
    return { client, service };
  };

  it('counts the messages by level since the last check, per entity type', async () => {
    const { client, service } = createService();

    const result = await service.countMessages({ lastCheckedAt: 1700000000000 });

    expect(result).toEqual({ error: 3, warning: 0, info: 5 });
    const requests = client.asInternalUser.esql.query.mock.calls.map(([request]) => request);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      query:
        'FROM .ml-notifications* | WHERE job_id IN (?ids) | WHERE job_type == ?jobType AND timestamp > TO_DATETIME(?lastCheckedAt) | STATS count = COUNT(*) BY level | LIMIT 100',
      params: [
        { ids: ['job-1'] },
        { jobType: 'anomaly_detector' },
        { lastCheckedAt: 1700000000000 },
      ],
    });
    expect(requests[1]).not.toHaveProperty('project_routing');
  });

  it('sends project_routing when CPS is enabled', async () => {
    const { client, service } = createService({ isServerless: true, cpsEnabled: true });

    await service.countMessages({ lastCheckedAt: 1 });

    expect(client.asInternalUser.esql.query.mock.calls[0][0]).toHaveProperty(
      'project_routing',
      DEFAULT_ML_PROJECT_ROUTING
    );
  });
});
