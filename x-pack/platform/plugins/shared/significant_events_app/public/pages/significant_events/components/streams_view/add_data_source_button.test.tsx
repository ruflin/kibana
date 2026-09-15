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
import { ADD_DATA_SOURCE_BUTTON_LABEL, ADD_QUERY_STREAM_MENU_ITEM_LABEL } from './translations';

const mockFetch = jest.fn();
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
        streams: {
          streamsRepositoryClient: { fetch: mockFetch },
        },
      },
    },
  }),
}));

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
});
