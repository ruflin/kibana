/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import { resolveProbe } from './resolve_has_data_probes';

const fulfilledWithHits = (count: number): PromiseSettledResult<boolean> => ({
  status: 'fulfilled',
  value: count > 0,
});

const rejectedWith = (error: Error): PromiseSettledResult<boolean> => ({
  status: 'rejected',
  reason: error,
});

const noShardsError = () => {
  const error = new errors.ResponseError({
    statusCode: 503,
    body: {
      error: {
        type: 'search_phase_execution_exception',
        root_cause: [{ type: 'no_shard_available_action_exception' }],
      },
    },
    headers: {},
    warnings: [],
    meta: {} as never,
  });
  return error;
};

describe('resolveProbe', () => {
  it('returns true when documents are found', () => {
    expect(resolveProbe(fulfilledWithHits(1))).toBe(true);
  });

  it('returns false when no documents are found', () => {
    expect(resolveProbe(fulfilledWithHits(0))).toBe(false);
  });

  it('returns false on no shards available error', () => {
    expect(resolveProbe(rejectedWith(noShardsError()))).toBe(false);
  });

  it('throws on unexpected errors', () => {
    expect(() => resolveProbe(rejectedWith(new Error('Request timed out')))).toThrow(
      'Elasticsearch responded with an error. Request timed out'
    );
  });
});
