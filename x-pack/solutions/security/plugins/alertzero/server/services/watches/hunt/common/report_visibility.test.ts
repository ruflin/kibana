/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import { isReportVisibleToSpace } from './report_visibility';

const clientWith = (query: jest.Mock) => ({ esql: { query } } as unknown as ElasticsearchClient);

describe('isReportVisibleToSpace', () => {
  it('is true when the report row is returned for the space', async () => {
    const query = jest.fn().mockResolvedValue({
      columns: [{ name: '_id', type: 'keyword' }],
      values: [['report-1']],
    });

    await expect(
      isReportVisibleToSpace(clientWith(query), { spaceId: 'space-a', reportId: 'report-1' })
    ).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith({
      query:
        'FROM .kibana-threat-reports METADATA _id | WHERE _id == ?reportId | KEEP _id | LIMIT 1',
      params: [{ reportId: 'report-1' }],
      filter: { terms: { space_id: ['space-a', '*'] } },
    });
  });

  it('is false when no row matches', async () => {
    const query = jest.fn().mockResolvedValue({ columns: [], values: [] });

    await expect(
      isReportVisibleToSpace(clientWith(query), { spaceId: 'space-a', reportId: 'report-1' })
    ).resolves.toBe(false);
  });

  it('is false when the reports index does not exist yet', async () => {
    const query = jest.fn().mockRejectedValue(
      Object.assign(new Error('verification_exception'), {
        statusCode: 400,
        body: {
          error: {
            type: 'verification_exception',
            reason: 'Unknown index [.kibana-threat-reports]',
          },
        },
      })
    );

    await expect(
      isReportVisibleToSpace(clientWith(query), { spaceId: 'space-a', reportId: 'report-1' })
    ).resolves.toBe(false);
  });

  it('propagates other Elasticsearch errors', async () => {
    const query = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(
      isReportVisibleToSpace(clientWith(query), { spaceId: 'space-a', reportId: 'report-1' })
    ).rejects.toThrow('boom');
  });
});
