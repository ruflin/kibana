/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ISearchGeneric } from '@kbn/search-types';
import { of } from 'rxjs';
import { createActor, toPromise } from 'xstate';
import { countDocuments } from './count_documents';
import type { LogCategorizationParams } from './types';

const input: LogCategorizationParams = {
  index: 'logs-*, filebeat-*',
  startTimestamp: '2025-01-01T00:00:00.000Z',
  endTimestamp: '2025-01-02T00:00:00.000Z',
  timeField: '@timestamp',
  messageField: 'message',
  documentFilters: [{ term: { 'log.level': 'error' } }],
} as LogCategorizationParams;

describe('countDocuments', () => {
  it('counts with ES|QL and keeps the DSL filters as the request filter', async () => {
    const search = jest.fn().mockReturnValue(
      of({
        rawResponse: { columns: [{ name: 'total', type: 'long' }], values: [[250_000]] },
      })
    );

    const actor = createActor(countDocuments({ search: search as unknown as ISearchGeneric }), {
      input,
    });
    actor.start();
    const result = await toPromise(actor);

    expect(result.documentCount).toBe(250_000);
    expect(result.samplingProbability).toBeGreaterThan(0);
    expect(result.samplingProbability).toBeLessThan(1);

    const [{ params }, options] = search.mock.calls[0];
    expect(params.query).toBe('FROM logs-*, filebeat-* | STATS total = COUNT(*)');
    expect(params.filter.bool.filter).toEqual(
      expect.arrayContaining([{ exists: { field: 'message' } }, { term: { 'log.level': 'error' } }])
    );
    expect(options).toEqual(expect.objectContaining({ strategy: 'esql_async' }));
  });
});
