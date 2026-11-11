/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';

import type { ElasticsearchClient } from '@kbn/core/server';

import { paramsSearchQueryMock } from './__mocks__/params_search_query';
import { fieldCapsPgBenchMock } from './__mocks__/field_caps_pgbench';
import { fieldCapsEcommerceMock } from './__mocks__/field_caps_ecommerce';
import { fieldCapsLargeArraysMock } from './__mocks__/field_caps_large_arrays';

import { fetchIndexInfo } from './fetch_index_info';

describe('fetchIndexInfo', () => {
  it('returns field candidates and total hits for "my" fields', async () => {
    const esClientFieldCapsMock = jest.fn(() => ({
      fields: {
        // Should end up as a field candidate
        myIpFieldName: { ip: { aggregatable: true } },
        // Should end up as a field candidate
        myKeywordFieldName: { keyword: { aggregatable: true } },
        // Should not end up as a field candidate, it's a keyword but non-aggregatable
        myKeywordFieldNameToBeIgnored: { keyword: { aggregatable: false } },
        // Should not end up as a field candidate since fields of type number will not be considered
        myNumericFieldName: { number: {} },
      },
    }));
    const esClientSearchMock = jest.fn(async (_req: EsqlQueryRequest) => ({
      columns: [{ name: 'total', type: 'long' }],
      values: [[5000000]],
    }));

    const esClientMock = {
      fieldCaps: esClientFieldCapsMock,
      esql: { query: esClientSearchMock },
    } as unknown as ElasticsearchClient;

    const { baselineTotalDocCount, deviationTotalDocCount, keywordFieldCandidates } =
      await fetchIndexInfo({
        esClient: esClientMock,
        arguments: { ...paramsSearchQueryMock, textFieldCandidatesOverrides: [] },
      });

    expect(keywordFieldCandidates).toEqual(['myIpFieldName', 'myKeywordFieldName']);
    expect(baselineTotalDocCount).toEqual(5000000);
    expect(deviationTotalDocCount).toEqual(5000000);
    expect(esClientFieldCapsMock).toHaveBeenCalledTimes(1);
    expect(esClientSearchMock).toHaveBeenCalledTimes(2);
  });

  it('returns field candidates and total hits for pgBench mappings', async () => {
    const esClientFieldCapsMock = jest.fn(() => fieldCapsPgBenchMock);
    const esClientSearchMock = jest.fn(async (_req: EsqlQueryRequest) => ({
      columns: [{ name: 'total', type: 'long' }],
      values: [[5000000]],
    }));

    const esClientMock = {
      fieldCaps: esClientFieldCapsMock,
      esql: { query: esClientSearchMock },
    } as unknown as ElasticsearchClient;

    const {
      baselineTotalDocCount,
      deviationTotalDocCount,
      keywordFieldCandidates,
      textFieldCandidates,
    } = await fetchIndexInfo({
      esClient: esClientMock,
      arguments: { ...paramsSearchQueryMock, textFieldCandidatesOverrides: [] },
    });

    expect(keywordFieldCandidates).toEqual([
      'agent.name',
      'agent.type',
      'agent.version',
      'client.geo.city_name',
      'client.geo.continent_name',
      'client.geo.country_name',
      'client.geo.region_name',
      'client.ip',
      'cloud.account.id',
      'cloud.availability_zone',
      'cloud.instance.id',
      'cloud.machine.type',
      'cloud.project.id',
      'cloud.provider',
      'cloud.service.name',
      'container.id',
      'container.image.name',
      'container.name',
      'container.runtime',
      'data_stream.dataset',
      'data_stream.namespace',
      'data_stream.type',
      'ecs.version',
      'event.category',
      'event.dataset',
      'event.kind',
      'event.module',
      'event.timezone',
      'event.type',
      'host.architecture',
      'host.ip',
      'host.name',
      'host.os.family',
      'host.os.kernel',
      'host.os.name',
      'host.os.platform',
      'host.os.version',
      'log.file.path',
      'log.level',
      'log.logger',
      'log.origin.file.name',
      'log.origin.function',
      'process.name',
      'service.name',
      'service.type',
      'user.name',
    ]);
    expect(textFieldCandidates).toEqual(['error.message', 'message']);
    expect(baselineTotalDocCount).toEqual(5000000);
    expect(deviationTotalDocCount).toEqual(5000000);
    expect(esClientFieldCapsMock).toHaveBeenCalledTimes(1);
    expect(esClientSearchMock).toHaveBeenCalledTimes(2);
  });

  it('returns field candidates and total hits for ecommerce mappings', async () => {
    const esClientFieldCapsMock = jest.fn(() => fieldCapsEcommerceMock);
    const esClientSearchMock = jest.fn(async (_req: EsqlQueryRequest) => ({
      columns: [{ name: 'total', type: 'long' }],
      values: [[5000000]],
    }));

    const esClientMock = {
      fieldCaps: esClientFieldCapsMock,
      esql: { query: esClientSearchMock },
    } as unknown as ElasticsearchClient;

    const {
      baselineTotalDocCount,
      deviationTotalDocCount,
      keywordFieldCandidates,
      textFieldCandidates,
    } = await fetchIndexInfo({
      esClient: esClientMock,
      arguments: { ...paramsSearchQueryMock, textFieldCandidatesOverrides: [] },
    });

    expect(keywordFieldCandidates).toEqual([
      'category.keyword',
      'currency',
      'customer_first_name.keyword',
      'customer_full_name.keyword',
      'customer_gender',
      'customer_id',
      'customer_last_name.keyword',
      'customer_phone',
      'day_of_week',
      'email',
      'event.dataset',
      'geoip.city_name',
      'geoip.continent_name',
      'geoip.country_iso_code',
      'geoip.region_name',
      'manufacturer.keyword',
      'order_id',
      'products._id.keyword',
      'products.category.keyword',
      'products.manufacturer.keyword',
      'products.product_name.keyword',
      'products.sku',
      'sku',
      'type',
      'user',
    ]);
    expect(textFieldCandidates).toEqual([]);
    expect(baselineTotalDocCount).toEqual(5000000);
    expect(deviationTotalDocCount).toEqual(5000000);
    expect(esClientFieldCapsMock).toHaveBeenCalledTimes(1);
    expect(esClientSearchMock).toHaveBeenCalledTimes(2);
  });

  it('returns field candidates and total hits for large-arrays mappings', async () => {
    const esClientFieldCapsMock = jest.fn(() => fieldCapsLargeArraysMock);
    const esClientSearchMock = jest.fn(async (_req: EsqlQueryRequest) => ({
      columns: [{ name: 'total', type: 'long' }],
      values: [[5000000]],
    }));

    const esClientMock = {
      fieldCaps: esClientFieldCapsMock,
      esql: { query: esClientSearchMock },
    } as unknown as ElasticsearchClient;

    const {
      baselineTotalDocCount,
      deviationTotalDocCount,
      keywordFieldCandidates,
      textFieldCandidates,
    } = await fetchIndexInfo({
      esClient: esClientMock,
      arguments: { ...paramsSearchQueryMock, textFieldCandidatesOverrides: [] },
    });

    expect(keywordFieldCandidates).toEqual(['items']);
    expect(textFieldCandidates).toEqual([]);
    expect(baselineTotalDocCount).toEqual(5000000);
    expect(deviationTotalDocCount).toEqual(5000000);
    expect(esClientFieldCapsMock).toHaveBeenCalledTimes(1);
    expect(esClientSearchMock).toHaveBeenCalledTimes(2);
  });

  it('counts the documents of each window with a STATS query and the search query as filter', async () => {
    const esClientSearchMock = jest.fn(async (_req: EsqlQueryRequest) => ({
      columns: [{ name: 'total', type: 'long' }],
      values: [[7]],
    }));
    const esClientMock = {
      fieldCaps: jest.fn(() => ({ fields: {} })),
      esql: { query: esClientSearchMock },
    } as unknown as ElasticsearchClient;

    const { baselineTotalDocCount, zeroDocsFallback } = await fetchIndexInfo({
      esClient: esClientMock,
      arguments: {
        ...paramsSearchQueryMock,
        textFieldCandidatesOverrides: [],
        skipFieldCandidates: true,
      },
    });

    expect(baselineTotalDocCount).toBe(7);
    expect(zeroDocsFallback).toBe(false);
    expect(esClientSearchMock).toHaveBeenCalledTimes(2);
    const request = esClientSearchMock.mock.calls[0][0];
    expect(request.query).toBe(`FROM ${paramsSearchQueryMock.index} | STATS total = COUNT(*)`);
    expect(request.filter).toEqual({
      bool: {
        filter: expect.arrayContaining([
          {
            range: {
              [paramsSearchQueryMock.timeFieldName]: {
                gte: paramsSearchQueryMock.baselineMin,
                lte: paramsSearchQueryMock.baselineMax,
                format: 'epoch_millis',
              },
            },
          },
        ]),
      },
    });
  });

  it('counts no documents for a missing index', async () => {
    const esClientMock = {
      fieldCaps: jest.fn(() => ({ fields: {} })),
      esql: {
        query: jest.fn().mockRejectedValue({
          statusCode: 400,
          body: {
            error: { type: 'verification_exception', reason: 'Unknown index [my-index]' },
          },
        }),
      },
    } as unknown as ElasticsearchClient;

    const { baselineTotalDocCount, deviationTotalDocCount, zeroDocsFallback } =
      await fetchIndexInfo({
        esClient: esClientMock,
        arguments: {
          ...paramsSearchQueryMock,
          textFieldCandidatesOverrides: [],
          skipFieldCandidates: true,
        },
      });

    expect(baselineTotalDocCount).toBe(0);
    expect(deviationTotalDocCount).toBe(0);
    expect(zeroDocsFallback).toBe(true);
  });
});
