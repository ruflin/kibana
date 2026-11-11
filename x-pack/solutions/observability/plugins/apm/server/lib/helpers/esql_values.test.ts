/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { esqlResponse } from '../../utils/esql_test_helpers';
import {
  addTimeBucket,
  esqlGroupedSeries,
  esqlRowAsFields,
  esqlRowsAsFields,
  esqlTermsBuckets,
  getTimeBucketKeys,
  toEpochMillis,
  whereIn,
  whereTerm,
} from './esql_values';

describe('esql_values', () => {
  describe('toEpochMillis', () => {
    it('parses ISO dates and passes numbers through', () => {
      expect(toEpochMillis('2023-11-14T22:13:20.000Z')).toBe(1_700_000_000_000);
      expect(toEpochMillis(1_700_000_000_000)).toBe(1_700_000_000_000);
    });

    it('returns null for a missing or invalid value', () => {
      expect(toEpochMillis(null)).toBeNull();
      expect(toEpochMillis('not a date')).toBeNull();
    });
  });

  describe('esqlRowsAsFields', () => {
    it('wraps values in arrays like the Query DSL fields option and drops nulls', () => {
      const response = esqlResponse(
        ['service.name', 'host.name', 'tags'],
        [['svc', null, ['a', 'b']]]
      );

      expect(esqlRowsAsFields(response)).toEqual([{ 'service.name': ['svc'], tags: ['a', 'b'] }]);
      expect(esqlRowAsFields(esqlResponse([], []))).toBeUndefined();
    });
  });

  describe('time buckets', () => {
    it('adds the epoch-aligned bucket start with a named interval', () => {
      const { query, params } = addTimeBucket(esql.from('idx'), 60_000).toRequest();

      expect(query).toBe(
        'FROM idx | EVAL bucket = TO_LONG(@timestamp) - TO_LONG(@timestamp) % ?intervalMs'
      );
      expect(params).toEqual([{ intervalMs: 60_000 }]);
    });

    it('lists every bucket from the one holding start to the one holding end', () => {
      expect(getTimeBucketKeys({ start: 90_000, end: 300_000, intervalMs: 60_000 })).toEqual([
        60_000, 120_000, 180_000, 240_000, 300_000,
      ]);
    });

    it('lists no bucket for an interval that is not positive', () => {
      expect(getTimeBucketKeys({ start: 0, end: 1000, intervalMs: 0 })).toEqual([]);
    });
  });

  describe('where clauses', () => {
    it('writes a term as a named parameter and skips a null value', () => {
      expect(whereTerm(esql.from('idx'), 'service.name', 'svc').toRequest()).toEqual({
        query: 'FROM idx | WHERE `service.name` == ?service_name_value',
        params: [{ service_name_value: 'svc' }],
      });
      expect(whereTerm(esql.from('idx'), 'service.name', undefined).toRequest().query).toBe(
        'FROM idx'
      );
    });

    it('writes a list as one array parameter and skips an empty list', () => {
      expect(whereIn(esql.from('idx'), 'span.id', ['a', 'b']).toRequest()).toEqual({
        query: 'FROM idx | WHERE `span.id` IN (?span_id_values)',
        params: [{ span_id_values: ['a', 'b'] }],
      });
      expect(whereIn(esql.from('idx'), 'span.id', []).toRequest().query).toBe('FROM idx');
    });
  });

  describe('esqlTermsBuckets', () => {
    it('keeps the top groups and counts the rest as other documents', () => {
      const response = esqlResponse(
        ['doc_count', 'device'],
        [
          [5, 'a'],
          [3, 'b'],
          [2, 'c'],
          [1, 'd'],
        ]
      );

      expect(esqlTermsBuckets(response, 'device', 2)).toEqual({
        buckets: [
          { key: 'a', doc_count: 5 },
          { key: 'b', doc_count: 3 },
        ],
        sum_other_doc_count: 3,
      });
    });
  });

  describe('esqlGroupedSeries', () => {
    it('orders the groups by documents and fills the buckets without documents', () => {
      const response = esqlResponse(
        ['doc_count', 'group', 'bucket'],
        [
          [1, 'few', 0],
          [4, 'many', 60_000],
          [2, 'many', 0],
        ]
      );

      expect(esqlGroupedSeries(response, 'group', [0, 60_000, 120_000])).toEqual([
        {
          group: 'many',
          timeseries: [
            { x: 0, y: 2 },
            { x: 60_000, y: 4 },
            { x: 120_000, y: 0 },
          ],
        },
        {
          group: 'few',
          timeseries: [
            { x: 0, y: 1 },
            { x: 60_000, y: 0 },
            { x: 120_000, y: 0 },
          ],
        },
      ]);
    });
  });
});
