/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { ESQLSearchResponse } from '@kbn/es-types';
import { DocumentsColumn } from './documents_column';

jest.mock('@kbn/charts-theme', () => ({
  useElasticChartsTheme: () => ({}),
}));

jest.mock('@elastic/charts', () => ({
  Chart: ({ children }: { children: React.ReactNode }) => (
    <div data-test-subj="documentsColumnChart">{children}</div>
  ),
  Settings: () => null,
  Tooltip: () => null,
  BarSeries: () => null,
  ScaleType: { Time: 'time', Linear: 'linear' },
  TooltipStickTo: { Middle: 'middle' },
  niceTimeFormatter: () => () => '',
}));

const timeState = {
  start: 1_700_000_000_000,
  end: 1_700_086_400_000,
} as never;

const histogramWithDocs: ESQLSearchResponse = {
  columns: [
    { name: '@timestamp', type: 'date' },
    { name: 'doc_count', type: 'long' },
  ],
  values: [
    ['2023-11-14T00:00:00.000Z', 100],
    ['2023-11-14T12:00:00.000Z', 200],
  ],
} as ESQLSearchResponse;

describe('DocumentsColumn', () => {
  it('shows a dash and spinner while the Streams histogram is loading', () => {
    render(
      <DocumentsColumn
        indexPattern="logs-generic-default"
        histogramQueryFetch={new Promise(() => undefined)}
        timeState={timeState}
        numDataPoints={25}
      />
    );

    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('shows a dash when the histogram is empty', async () => {
    render(
      <DocumentsColumn
        indexPattern="logs-generic-default"
        histogramQueryFetch={Promise.resolve({ columns: [], values: [] })}
        timeState={timeState}
        numDataPoints={25}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('streamsDocCount-logs-generic-default')).toHaveTextContent('-');
    });
    expect(screen.queryByTestId('documentsColumnChart')).not.toBeInTheDocument();
  });

  it('shows a warning icon when the histogram fails', async () => {
    render(
      <DocumentsColumn
        indexPattern="logs-generic-default"
        histogramQueryFetch={Promise.reject(new Error('histogram failed'))}
        timeState={timeState}
        numDataPoints={25}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('streamsDocCount-error')).toBeInTheDocument();
    });
  });

  it('renders the formatted document count from histogram buckets', async () => {
    render(
      <DocumentsColumn
        indexPattern="logs-generic-default"
        histogramQueryFetch={Promise.resolve(histogramWithDocs)}
        timeState={timeState}
        numDataPoints={25}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('streamsDocCount-logs-generic-default')).toHaveTextContent('300');
    });
    expect(screen.getByTestId('documentsColumnChart')).toBeInTheDocument();
  });
});
