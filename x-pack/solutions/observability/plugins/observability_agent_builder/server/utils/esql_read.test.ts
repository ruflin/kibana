/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock } from '@kbn/core/server/mocks';
import { errors } from '@elastic/elasticsearch';
import { esqlCount, isEsqlUnknownIndexError, toEsqlSources } from './esql_read';

const unknownIndexError = () =>
  new errors.ResponseError({
    statusCode: 400,
    body: { error: { type: 'verification_exception', reason: 'Unknown index [logs-*]' } },
    warnings: [],
    headers: {},
    meta: {} as never,
  });

describe('esql_read', () => {
  it('splits a comma separated index expression into sources', () => {
    expect(toEsqlSources('logs-*, metrics-*,')).toEqual(['logs-*', 'metrics-*']);
  });

  it.each([
    'logs-* | DROP message',
    'logs-*\nFROM other',
    'logs "x"',
    'logs x',
    '_hidden',
    '-logs',
    '+logs',
    'logs-*)',
    `a${'b'.repeat(300)}`,
  ])('rejects the source %j', (source) => {
    expect(() => toEsqlSources(source)).toThrow(/Invalid index name or pattern/);
    expect(() => toEsqlSources([source])).toThrow(/Invalid index name or pattern/);
  });

  it('accepts index names, wildcards, remote prefixes and selectors', () => {
    expect(
      toEsqlSources('.alerts-*,remote_1:logs-*.otel-*,traces-apm*,logs-foo::failures')
    ).toEqual(['.alerts-*', 'remote_1:logs-*.otel-*', 'traces-apm*', 'logs-foo::failures']);
  });

  it('recognises the unknown index error only', () => {
    expect(isEsqlUnknownIndexError(unknownIndexError())).toBe(true);
    expect(isEsqlUnknownIndexError(new Error('boom'))).toBe(false);
  });

  describe('esqlCount', () => {
    it('counts with STATS and sends the Query DSL as the request filter', async () => {
      const esClient = elasticsearchServiceMock.createElasticsearchClient();
      esClient.esql.query.mockResolvedValue({
        columns: [{ name: 'total', type: 'long' }],
        values: [[42]],
      } as never);
      const filter = { bool: { filter: [{ term: { 'service.name': 'a' } }] } };

      await expect(esqlCount({ esClient, index: 'logs-*,metrics-*', filter })).resolves.toBe(42);

      expect(esClient.esql.query).toHaveBeenCalledWith({
        query: 'FROM logs-*, metrics-* | STATS total = COUNT(*)',
        params: [],
        filter,
      });
    });

    it('returns 0 for an index that does not exist and rethrows other errors', async () => {
      const esClient = elasticsearchServiceMock.createElasticsearchClient();
      esClient.esql.query.mockRejectedValueOnce(unknownIndexError());
      await expect(esqlCount({ esClient, index: 'logs-*' })).resolves.toBe(0);

      esClient.esql.query.mockRejectedValueOnce(new Error('boom'));
      await expect(esqlCount({ esClient, index: 'logs-*' })).rejects.toThrow('boom');
    });
  });
});
