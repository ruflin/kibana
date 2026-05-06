/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@kbn/react-query';
import { useConversationList } from './use_conversation_list';

const mockList = jest.fn();

jest.mock('./use_agent_builder_service', () => ({
  useAgentBuilderServices: () => ({
    conversationsService: { list: mockList },
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'UseConversationListTestWrapper';
  return Wrapper;
};

describe('useConversationList', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockList.mockResolvedValue([]);
  });

  it('calls list with includeHidden=false by default', async () => {
    renderHook(() => useConversationList({ agentId: 'agent-1' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledTimes(1);
    });
    expect(mockList).toHaveBeenCalledWith({ agentId: 'agent-1', includeHidden: false });
  });

  it('forwards includeHidden=true when toggle is on', async () => {
    renderHook(() => useConversationList({ agentId: 'agent-1', includeHidden: true }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledTimes(1);
    });
    expect(mockList).toHaveBeenCalledWith({ agentId: 'agent-1', includeHidden: true });
  });

  it('caches visible and hidden lists separately (no flicker on toggle)', async () => {
    // Two render passes with the same agent but different includeHidden should produce
    // two distinct queryKey cache entries, hence two list() invocations.
    const wrapper = createWrapper();

    const { rerender } = renderHook(
      ({ includeHidden }: { includeHidden: boolean }) =>
        useConversationList({ agentId: 'agent-1', includeHidden }),
      {
        wrapper,
        initialProps: { includeHidden: false },
      }
    );

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledTimes(1);
    });

    rerender({ includeHidden: true });

    await waitFor(() => {
      expect(mockList).toHaveBeenCalledTimes(2);
    });

    expect(mockList).toHaveBeenNthCalledWith(1, { agentId: 'agent-1', includeHidden: false });
    expect(mockList).toHaveBeenNthCalledWith(2, { agentId: 'agent-1', includeHidden: true });
  });
});
