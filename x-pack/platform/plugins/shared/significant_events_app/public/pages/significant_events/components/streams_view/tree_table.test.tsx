/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { SignificantEventsWorkflowStatus } from '@kbn/significant-events-schema';
import type { ListStreamDetail } from '@kbn/streams-plugin/server/routes/internal/streams/crud/route';
import { StreamsTreeTable } from './tree_table';
import { parseSearchQuery } from './utils';

const mockGetStreamHistogram = jest.fn((streamName: string) =>
  Promise.resolve({ columns: [], values: [], streamName })
);

jest.mock('../../../../hooks/use_kibana', () => ({
  useKibana: () => ({
    dependencies: {
      start: {
        share: {
          url: {
            locators: {
              get: () => ({
                getRedirectUrl: ({ name }: { name: string }) => `/streams/${name}`,
              }),
            },
          },
        },
      },
    },
  }),
}));

jest.mock('../../../../hooks/use_timefilter', () => ({
  useTimefilter: () => ({
    timeState: { start: 1_700_000_000_000, end: 1_700_086_400_000 },
  }),
}));

jest.mock('../../../../hooks/use_stream_histogram_fetch', () => ({
  STREAMS_HISTOGRAM_NUM_DATA_POINTS: 25,
  useStreamHistogramFetch: () => ({
    getStreamHistogram: mockGetStreamHistogram,
  }),
}));

jest.mock('./documents_column', () => ({
  DocumentsColumn: ({
    indexPattern,
    numDataPoints,
  }: {
    indexPattern: string;
    numDataPoints: number;
  }) => (
    <div data-test-subj={`streamsDocCount-${indexPattern}`} data-num-data-points={numDataPoints}>
      522,131
    </div>
  ),
}));

jest.mock('./knowledge_indicators_column', () => ({
  KnowledgeIndicatorsColumn: () => <span data-test-subj="knowledgeIndicatorsColumnMock">26</span>,
}));

const createClassicStream = (name: string): ListStreamDetail =>
  ({
    stream: {
      type: 'classic',
      name,
      description: '',
      updated_at: '2025-01-01T00:00:00.000Z',
      ingest: {
        lifecycle: { dsl: {} },
        processing: { steps: [], updated_at: '2025-01-01T00:00:00.000Z' },
        settings: {},
        failure_store: { lifecycle: { enabled: { data_retention: '30d' } } },
        classic: {},
      },
    },
    effective_lifecycle: { dsl: {} },
    data_stream: undefined,
    privileges: { read_failure_store: true },
  } as ListStreamDetail);

const createQueryStream = (name: string): ListStreamDetail =>
  ({
    stream: {
      type: 'query',
      name,
      description: '',
      updated_at: '2025-01-01T00:00:00.000Z',
      query: {
        view: `stream.${name}`,
        esql: 'FROM logs | WHERE service.name == "query-child"',
      },
    },
    privileges: { read_failure_store: false },
  } as ListStreamDetail);

describe('StreamsTreeTable', () => {
  beforeEach(() => {
    mockGetStreamHistogram.mockClear();
  });

  it('keeps Name, Documents, Enabled, Status, and KI Features, and drops KI Queries, Events, and Actions', () => {
    render(
      <StreamsTreeTable
        streams={[createClassicStream('logs-generic-default')]}
        streamOnboardingResultMap={{
          'logs-generic-default': {
            status: SignificantEventsWorkflowStatus.Completed,
            executionId: 'exec-1',
          },
        }}
        searchQuery={parseSearchQuery('')}
        isStreamEnabled={() => true}
        isStreamToggleDisabled={() => false}
        onStreamEnabledChange={jest.fn()}
      />
    );

    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Enabled' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'KI Features' })).toBeInTheDocument();

    expect(screen.getByTestId('streamsDocCount-logs-generic-default')).toHaveTextContent('522,131');
    expect(mockGetStreamHistogram).toHaveBeenCalledWith('logs-generic-default');

    expect(screen.queryByRole('columnheader', { name: 'KI Queries' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^Events/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();

    expect(
      screen.getByTestId('significantEventsStreamEnabledSwitch-logs-generic-default')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Onboard stream')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stop stream onboarding')).not.toBeInTheDocument();
  });

  it('wires the Streams documents sparkline for classic and query streams', () => {
    render(
      <StreamsTreeTable
        streams={[createClassicStream('logs-generic-default'), createQueryStream('query-errors')]}
        streamOnboardingResultMap={{}}
        searchQuery={parseSearchQuery('')}
        isStreamEnabled={() => true}
        isStreamToggleDisabled={() => false}
        onStreamEnabledChange={jest.fn()}
      />
    );

    expect(screen.getByTestId('streamsDocCount-logs-generic-default')).toBeInTheDocument();
    expect(screen.getByTestId('streamsDocCount-query-errors')).toBeInTheDocument();
    expect(mockGetStreamHistogram).toHaveBeenCalledWith('logs-generic-default');
    expect(mockGetStreamHistogram).toHaveBeenCalledWith('query-errors');
  });
});
