/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { renderHook } from '@testing-library/react';
import { of } from 'rxjs';
import { executeEsqlQuery } from '../util/execute_esql_query';
import { useKibana } from './use_kibana';
import { useTimefilter } from './use_timefilter';
import {
  STREAMS_HISTOGRAM_NUM_DATA_POINTS,
  useStreamHistogramFetch,
} from './use_stream_histogram_fetch';

jest.mock('./use_kibana', () => ({
  useKibana: jest.fn(),
}));

jest.mock('./use_timefilter', () => ({
  useTimefilter: jest.fn(),
}));

jest.mock('../util/execute_esql_query', () => ({
  executeEsqlQuery: jest.fn(),
}));

const mockUseKibana = useKibana as jest.MockedFunction<typeof useKibana>;
const mockUseTimefilter = useTimefilter as jest.MockedFunction<typeof useTimefilter>;
const mockExecuteEsqlQuery = executeEsqlQuery as jest.MockedFunction<typeof executeEsqlQuery>;

const start = 1_700_000_000_000;
const end = start + 24 * 60 * 60 * 1000;
const search = jest.fn();
const uiSettingsGet = jest.fn(() => 'Browser');

describe('useStreamHistogramFetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseKibana.mockReturnValue({
      dependencies: {
        start: {
          data: { search: { search } },
        },
      },
      core: { uiSettings: { get: uiSettingsGet } },
    } as never);
    mockUseTimefilter.mockReturnValue({
      timeState: { start, end },
      timeState$: of({ kind: 'initial' }),
    } as never);
    mockExecuteEsqlQuery.mockResolvedValue({ columns: [], values: [] });
  });

  it('queries the Streams ingest histogram for the toolbar time range', async () => {
    const { result } = renderHook(() =>
      useStreamHistogramFetch({
        getCanReadFailureStore: () => false,
        numDataPoints: STREAMS_HISTOGRAM_NUM_DATA_POINTS,
      })
    );

    await result.current.getStreamHistogram('logs-generic-default');

    expect(mockExecuteEsqlQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        start,
        end,
        search,
        query: expect.stringContaining('STATS doc_count = COUNT(*)'),
      })
    );
    expect(mockExecuteEsqlQuery.mock.calls[0][0].query).toContain('logs-generic-default');
    expect(mockExecuteEsqlQuery.mock.calls[0][0].query).not.toContain('::failures');
  });

  it('includes the failure store when the stream allows it', async () => {
    const { result } = renderHook(() =>
      useStreamHistogramFetch({
        getCanReadFailureStore: () => true,
        numDataPoints: STREAMS_HISTOGRAM_NUM_DATA_POINTS,
      })
    );

    await result.current.getStreamHistogram('logs-generic-default');

    expect(mockExecuteEsqlQuery.mock.calls[0][0].query).toContain(
      'logs-generic-default,logs-generic-default::failures'
    );
  });

  it('treats unknown-index errors as an empty histogram', async () => {
    mockExecuteEsqlQuery.mockRejectedValueOnce(new Error('Unknown index [logs.missing]'));

    const { result } = renderHook(() =>
      useStreamHistogramFetch({
        getCanReadFailureStore: () => false,
        numDataPoints: STREAMS_HISTOGRAM_NUM_DATA_POINTS,
      })
    );

    await expect(result.current.getStreamHistogram('logs.missing')).resolves.toEqual({
      columns: [],
      values: [],
    });
  });
});
