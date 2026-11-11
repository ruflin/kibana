/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { ElasticsearchClient } from '@kbn/core/server';
import { hasDocuments } from './esql';

const createClient = (query: jest.Mock) => ({ esql: { query } } as unknown as ElasticsearchClient);

const unknownIndexError = () =>
  new errors.ResponseError({
    statusCode: 400,
    body: {
      error: {
        type: 'verification_exception',
        reason: 'Found 1 problem\nline 1:6: Unknown index [logs-*]',
      },
    },
    headers: {},
    warnings: [],
    meta: {} as never,
  });

describe('hasDocuments', () => {
  it('probes for one document with the terms as named params and unmapped fields as null', async () => {
    const query = jest.fn().mockResolvedValue({ columns: [{ name: '_id' }], values: [['a']] });

    await expect(
      hasDocuments({
        esClient: createClient(query),
        indices: ['logs-*', 'metrics-*'],
        terms: [
          { field: 'agent.id', value: 'agent-1' },
          { field: 'os.type', value: 'linux' },
        ],
        filter: { range: { '@timestamp': { gte: 'now-5m' } } },
      })
    ).resolves.toBe(true);

    expect(query).toHaveBeenCalledWith({
      query:
        'SET unmapped_fields = "NULLIFY"; FROM logs-*, metrics-* METADATA _id | WHERE agent.id == ?term0 | WHERE os.type == ?term1 | KEEP _id | LIMIT 1',
      params: [{ term0: 'agent-1' }, { term1: 'linux' }],
      filter: { range: { '@timestamp': { gte: 'now-5m' } } },
    });
  });

  it('is false when no document matches', async () => {
    const query = jest.fn().mockResolvedValue({ columns: [{ name: '_id' }], values: [] });

    await expect(
      hasDocuments({ esClient: createClient(query), indices: ['logs-*'] })
    ).resolves.toBe(false);
  });

  it('is false when no index matches, like ignore_unavailable', async () => {
    const query = jest.fn().mockRejectedValue(unknownIndexError());

    await expect(
      hasDocuments({ esClient: createClient(query), indices: ['logs-*'] })
    ).resolves.toBe(false);
  });

  it('rethrows other errors', async () => {
    const query = jest.fn().mockRejectedValue(new Error('Request timed out'));

    await expect(
      hasDocuments({ esClient: createClient(query), indices: ['logs-*'] })
    ).rejects.toThrow('Request timed out');
  });
});
