/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ESQLSearchResponse } from '@kbn/es-types';
import {
  buildSamplesEsqlQuery,
  buildTimeRangeFilter,
  extractDocumentsFromEsqlResponse,
} from './data_collector_actor';

describe('data_collector_actor samples query', () => {
  it('reads the latest documents of the stream, newest first, with an explicit limit', () => {
    expect(buildSamplesEsqlQuery({ index: 'logs.otel', size: 50 }, 'latest-samples')).toBe(
      'FROM logs.otel METADATA _id, _source\n| SORT @timestamp DESC\n| LIMIT 50'
    );
  });

  it('defaults to 100 documents', () => {
    expect(buildSamplesEsqlQuery({ index: 'logs' }, 'latest-samples')).toMatch(/LIMIT 100$/);
  });

  it('turns the KQL query into a WHERE before the sort', () => {
    expect(
      buildSamplesEsqlQuery(
        { index: 'logs', query: { language: 'kuery', query: 'log.level: error' } },
        'kql-samples'
      )
    ).toBe(
      'FROM logs METADATA _id, _source\n| WHERE KQL("""log.level: error""")\n| SORT @timestamp DESC\n| LIMIT 100'
    );
  });

  it('reads the failure store with the ::failures selector', () => {
    expect(buildSamplesEsqlQuery({ index: 'logs' }, 'failure-store')).toMatch(
      /^FROM logs::failures METADATA _id, _source/
    );
  });

  it('keeps the time range as a request filter, so date math still works', () => {
    expect(buildTimeRangeFilter({ from: 'now-15m', to: 'now' })).toEqual({
      bool: { filter: [{ range: { '@timestamp': { gte: 'now-15m', lte: 'now' } } }] },
    });
    expect(buildTimeRangeFilter(undefined)).toBeUndefined();
  });

  it('returns the _source with its _id', () => {
    const response = {
      columns: [
        { name: '_id', type: 'keyword' },
        { name: '_source', type: 'object' },
      ],
      values: [['a1', { message: 'hello', log: { level: 'info' } }]],
    } as ESQLSearchResponse;

    expect(extractDocumentsFromEsqlResponse(response)).toEqual([
      { _id: 'a1', message: 'hello', log: { level: 'info' } },
    ]);
  });
});
