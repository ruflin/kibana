/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { hasDocumentsInRange } from './get_apm_dataset_info';

describe('hasDocumentsInRange', () => {
  const startInMs = Date.parse('2026-01-01T00:00:00.000Z');
  const endInMs = Date.parse('2026-01-02T00:00:00.000Z');

  const setup = (query: jest.Mock) =>
    hasDocumentsInRange({
      esClient: { esql: { query } } as unknown as ElasticsearchClient,
      index: 'traces-apm*',
      startInMs,
      endInMs,
    });

  it('probes the index with a single-row ES|QL query and named time params', async () => {
    const query = jest.fn().mockResolvedValue({ columns: [], values: [[1]] });

    await expect(setup(query)).resolves.toBe(true);

    const request = query.mock.calls[0][0];
    expect(request.query).toContain('FROM traces-apm*');
    expect(request.query).toContain('LIMIT 1');
    expect(request.query).not.toContain('2026-01-01');
    expect(request.params).toEqual(
      expect.arrayContaining([
        { start: '2026-01-01T00:00:00.000Z' },
        { end: '2026-01-02T00:00:00.000Z' },
      ])
    );
  });

  it('returns false when there are no documents', async () => {
    const query = jest.fn().mockResolvedValue({ columns: [], values: [] });
    await expect(setup(query)).resolves.toBe(false);
  });

  it('returns false for an unknown index and rethrows other errors', async () => {
    const unknownIndex = Object.assign(new Error('x'), {
      statusCode: 400,
      body: { error: { type: 'verification_exception', reason: 'Unknown index [traces-apm*]' } },
    });
    await expect(setup(jest.fn().mockRejectedValue(unknownIndex))).resolves.toBe(false);
    await expect(setup(jest.fn().mockRejectedValue(new Error('boom')))).rejects.toThrow('boom');
  });
});
