/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@kbn/react-query';
import React, { type ReactNode } from 'react';
import { FEATURES_QUERY_KEY } from '../../../../hooks/use_fetch_features';
import { GENERATE_TOPOLOGY_ERROR_TITLE } from './translations';
import { useGenerateTopology } from './use_generate_topology';

const mockFetch = jest.fn();
const mockAddError = jest.fn();
const mockInvalidateQueries = jest.fn();

jest.mock('../../../../hooks/use_kibana', () => ({
  useKibana: () => ({
    core: {
      notifications: {
        toasts: { addError: mockAddError },
      },
    },
    dependencies: {
      start: {
        significantEvents: {
          significantEventsRepositoryClient: { fetch: mockFetch },
        },
      },
    },
  }),
}));

jest.mock('@kbn/react-query', () => {
  const actual = jest.requireActual('@kbn/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  };
});

describe('useGenerateTopology', () => {
  const wrapper = ({ children }: { children: ReactNode }) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      streamNames: ['logs.claims'],
      createdCount: 2,
      connectorId: 'connector-1',
    });
    mockInvalidateQueries.mockResolvedValue(undefined);
  });

  it('calls the topology generate API and invalidates knowledge-indicator queries', async () => {
    const { result } = renderHook(() => useGenerateTopology(), { wrapper });

    await result.current.generateTopology(['logs.claims']);

    expect(mockFetch).toHaveBeenCalledWith(
      'POST /internal/streams/knowledge_indicators/topology/_generate',
      {
        signal: null,
        params: { body: { streamNames: ['logs.claims'] } },
      }
    );
    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: FEATURES_QUERY_KEY });
    });
    expect(mockAddError).not.toHaveBeenCalled();
  });

  it('shows an error toast and never opens chat when generation fails', async () => {
    const failure = new Error('generation failed');
    mockFetch.mockRejectedValue(failure);
    const { result } = renderHook(() => useGenerateTopology(), { wrapper });

    await expect(result.current.generateTopology([])).rejects.toThrow('generation failed');

    await waitFor(() => {
      expect(mockAddError).toHaveBeenCalledWith(failure, { title: GENERATE_TOPOLOGY_ERROR_TITLE });
    });
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });
});
