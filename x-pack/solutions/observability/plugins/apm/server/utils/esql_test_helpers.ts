/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ESQLSearchResponse } from '@kbn/es-types';
import type { APMEventClient } from '../lib/helpers/create_es_client/create_apm_event_client';
import { inspectSearchParams } from './test_helpers';

export type APMEventEsqlRequest = Parameters<APMEventClient['esql']>[1];
type InspectFn = Parameters<typeof inspectSearchParams>[0];
type InspectOptions = Parameters<typeof inspectSearchParams>[1];

interface EsqlOptions extends NonNullable<InspectOptions> {
  /** The ES|QL response for a call, by operation name. Defaults to an empty result. */
  mockEsqlResponse?: (operationName: string, params: APMEventEsqlRequest) => ESQLSearchResponse;
}

/**
 * Like `inspectSearchParams`, for code that reads through `apmEventClient.esql`. The mock client
 * gets an `esql` spy next to `search`.
 */
export async function inspectEsqlParams(fn: InspectFn, options: EsqlOptions = {}) {
  const { mockEsqlResponse, ...searchOptions } = options;
  const esqlSpy = jest
    .fn<Promise<ESQLSearchResponse>, [operationName: string, params: APMEventEsqlRequest]>()
    .mockImplementation(async (operationName, params) =>
      mockEsqlResponse ? mockEsqlResponse(operationName, params) : { columns: [], values: [] }
    );

  const result = await inspectSearchParams(
    (args) =>
      fn({
        ...args,
        mockApmEventClient: Object.assign(args.mockApmEventClient, {
          esql: esqlSpy,
        }) as APMEventClient,
      }),
    searchOptions
  );

  return {
    ...result,
    esqlSpy,
    /** The `esql` params of the first call. */
    params: esqlSpy.mock.calls[0]?.[1],
    teardown: () => {
      esqlSpy.mockClear();
      result.teardown();
    },
  };
}

export type EsqlParamsMock = Awaited<ReturnType<typeof inspectEsqlParams>>;

/** The composed request (query text and named params) of an `esql` call, over a fixed index. */
export function toEsqlRequest(params: APMEventEsqlRequest | undefined) {
  if (!params) {
    throw new Error('no esql call recorded');
  }
  const { query, params: namedParams } = params.query(['myIndex']).toRequest();
  return { query, params: namedParams, filter: params.filter, apm: params.apm };
}

export function esqlResponse(
  columns: string[],
  values: Array<Array<string | number | boolean | null | string[]>>
): ESQLSearchResponse {
  return { columns: columns.map((name) => ({ name, type: 'keyword' })), values };
}

/** A response with one column per key of the rows, null where a row has no value for it. */
export function esqlResponseFromRows(rows: Array<Record<string, unknown>>): ESQLSearchResponse {
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    columns: names.map((name) => ({ name, type: 'keyword' })),
    values: rows.map((row) => names.map((name) => row[name] ?? null)),
  };
}
