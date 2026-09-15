/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@kbn/react-query';
import { AddDataSourceButton } from './add_data_source_button';
import {
  ADD_DATA_SOURCE_BUTTON_LABEL,
  ADD_QUERY_STREAM_MENU_ITEM_LABEL,
  ADD_SELECT_DATA_STREAMS_MENU_ITEM_LABEL,
} from './translations';

const mockFetch = jest.fn();
const mockGetIndices = jest.fn();
const mockAddSuccess = jest.fn();
const mockAddDanger = jest.fn();

jest.mock('../../../../hooks/use_kibana', () => ({
  useKibana: () => ({
    core: {
      notifications: {
        toasts: { addSuccess: mockAddSuccess, addDanger: mockAddDanger },
      },
    },
    dependencies: {
      start: {
        data: {
          dataViews: { getIndices: mockGetIndices },
        },
        streams: {
          streamsRepositoryClient: { fetch: mockFetch },
        },
      },
    },
  }),
}));

const dataStreamMatch = (name: string) => ({
  name,
  tags: [{ key: 'data_stream', name: 'Data stream' }],
  item: { name },
});

describe('AddDataSourceButton', () => {
  const renderButton = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <AddDataSourceButton />
      </QueryClientProvider>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({});
    mockGetIndices.mockResolvedValue([
      dataStreamMatch('logs-nginx-default'),
      dataStreamMatch('metrics-system.cpu-default'),
      dataStreamMatch('traces-apm-default'),
      {
        name: 'my-index',
        tags: [{ key: 'index', name: 'Index' }],
        item: { name: 'my-index' },
      },
    ]);
  });

  it('opens a Query stream selection instead of Find Significant Events', () => {
    renderButton();

    const addDataSourceButton = screen.getByTestId('significantEventsAddDataSourceButton');
    expect(addDataSourceButton).toHaveTextContent(ADD_DATA_SOURCE_BUTTON_LABEL);
    expect(
      addDataSourceButton.querySelector('[data-euiicon-type="plusCircle"]')
    ).toBeInTheDocument();
    expect(screen.queryByText('Find Significant Events')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('significantEventsAddDataSourceButton'));
    expect(screen.getByTestId('significantEventsAddQueryStreamMenuItem')).toHaveTextContent(
      ADD_QUERY_STREAM_MENU_ITEM_LABEL
    );
    expect(screen.getByTestId('significantEventsSelectDataStreamsMenuItem')).toHaveTextContent(
      ADD_SELECT_DATA_STREAMS_MENU_ITEM_LABEL
    );
  });

  it('creates a query stream from the flyout', async () => {
    renderButton();

    fireEvent.click(screen.getByTestId('significantEventsAddDataSourceButton'));
    fireEvent.click(screen.getByTestId('significantEventsAddQueryStreamMenuItem'));

    expect(screen.getByTestId('significantEventsCreateQueryStreamFlyout')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('significantEventsCreateQueryStreamName'), {
      target: { value: 'logs.checkout' },
    });
    fireEvent.change(screen.getByTestId('significantEventsCreateQueryStreamQuery'), {
      target: { value: 'FROM logs* | WHERE service.name == "checkout"' },
    });
    fireEvent.click(screen.getByTestId('significantEventsCreateQueryStreamSave'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('PUT /api/streams/{name}/_query 2023-10-31', {
        params: {
          path: { name: 'logs.checkout' },
          body: { query: { esql: 'FROM logs* | WHERE service.name == "checkout"' } },
        },
        signal: null,
      });
    });
    expect(mockAddSuccess).toHaveBeenCalled();
  });

  it('creates a query stream from selected data streams', async () => {
    renderButton();

    fireEvent.click(screen.getByTestId('significantEventsAddDataSourceButton'));
    fireEvent.click(screen.getByTestId('significantEventsSelectDataStreamsMenuItem'));

    expect(screen.getByTestId('significantEventsSelectDataStreamsFlyout')).toBeInTheDocument();
    expect(
      screen.getByTestId('significantEventsSelectDataStreamsLogsAndMetricsTab')
    ).toHaveTextContent('Logs & Metrics');

    await waitFor(() => {
      expect(screen.getByText('logs-nginx-default')).toBeInTheDocument();
    });
    expect(screen.getByText('metrics-system.cpu-default')).toBeInTheDocument();
    expect(screen.queryByText('traces-apm-default')).not.toBeInTheDocument();
    expect(screen.queryByText('my-index')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('significantEventsSelectDataStreamsOtherTab'));
    expect(screen.getByText('traces-apm-default')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('checkboxSelectRow-traces-apm-default'));

    fireEvent.click(screen.getByTestId('significantEventsSelectDataStreamsLogsAndMetricsTab'));
    fireEvent.click(screen.getByTestId('checkboxSelectRow-logs-nginx-default'));
    fireEvent.click(screen.getByTestId('checkboxSelectRow-metrics-system.cpu-default'));

    fireEvent.change(screen.getByTestId('significantEventsSelectDataStreamsName'), {
      target: { value: 'checkout-sources' },
    });
    fireEvent.click(screen.getByTestId('significantEventsSelectDataStreamsSave'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('PUT /api/streams/{name}/_query 2023-10-31', {
        params: {
          path: { name: 'checkout-sources' },
          body: {
            query: {
              esql: 'FROM "logs-nginx-default", "metrics-system.cpu-default", "traces-apm-default"',
            },
          },
        },
        signal: null,
      });
    });
    expect(mockAddSuccess).toHaveBeenCalled();
    expect(
      screen.queryByTestId('significantEventsSelectDataStreamsFlyout')
    ).not.toBeInTheDocument();
  });

  it('requires a name and at least one selected data stream before save', async () => {
    renderButton();

    fireEvent.click(screen.getByTestId('significantEventsAddDataSourceButton'));
    fireEvent.click(screen.getByTestId('significantEventsSelectDataStreamsMenuItem'));

    await waitFor(() => {
      expect(screen.getByText('logs-nginx-default')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('significantEventsSelectDataStreamsSave'));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Select at least one data stream')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('significantEventsSelectDataStreamsName'), {
      target: { value: 'checkout-sources' },
    });
    fireEvent.click(screen.getByTestId('checkboxSelectRow-logs-nginx-default'));
    fireEvent.click(screen.getByTestId('significantEventsSelectDataStreamsSave'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('PUT /api/streams/{name}/_query 2023-10-31', {
        params: {
          path: { name: 'checkout-sources' },
          body: { query: { esql: 'FROM "logs-nginx-default"' } },
        },
        signal: null,
      });
    });
  });

  it('keeps the flyout open and shows a toast when creating the query stream fails', async () => {
    mockFetch.mockRejectedValue(new Error('Stream already exists'));
    renderButton();

    fireEvent.click(screen.getByTestId('significantEventsAddDataSourceButton'));
    fireEvent.click(screen.getByTestId('significantEventsSelectDataStreamsMenuItem'));

    await waitFor(() => {
      expect(screen.getByText('logs-nginx-default')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('significantEventsSelectDataStreamsName'), {
      target: { value: 'checkout-sources' },
    });
    fireEvent.click(screen.getByTestId('checkboxSelectRow-logs-nginx-default'));
    fireEvent.click(screen.getByTestId('significantEventsSelectDataStreamsSave'));

    await waitFor(() => {
      expect(mockAddDanger).toHaveBeenCalled();
    });
    expect(screen.getByTestId('significantEventsSelectDataStreamsFlyout')).toBeInTheDocument();
  });
});
