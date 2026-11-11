/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { IScopedClusterClient } from '@kbn/core-elasticsearch-server';

import { analyticsEventsExist } from './analytics_events_exist';

describe('analytics collection events exists function', () => {
  const mockClient = {
    asCurrentUser: {
      esql: { query: jest.fn() },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checking if analytics events index exists', () => {
    it('should report no events when the data stream does not exist', async () => {
      mockClient.asCurrentUser.esql.query.mockRejectedValueOnce(
        new errors.ResponseError({
          statusCode: 400,
          body: {
            error: {
              type: 'verification_exception',
              reason: 'Found 1 problem\nline 1:6: Unknown index [example]',
            },
          },
          headers: {},
          meta: {} as never,
          warnings: [],
        })
      );
      await expect(
        analyticsEventsExist(mockClient as unknown as IScopedClusterClient, 'example')
      ).resolves.toEqual(false);
    });

    it('should call exists endpoint', async () => {
      mockClient.asCurrentUser.esql.query.mockImplementationOnce(() => ({
        columns: [{ name: 'total', type: 'long' }],
        values: [[1]],
      }));
      await expect(
        analyticsEventsExist(mockClient as unknown as IScopedClusterClient, 'example')
      ).resolves.toEqual(true);
      expect(mockClient.asCurrentUser.esql.query).toHaveBeenCalledWith({
        query: 'FROM example | STATS total = COUNT(*)',
      });
    });
  });
});
