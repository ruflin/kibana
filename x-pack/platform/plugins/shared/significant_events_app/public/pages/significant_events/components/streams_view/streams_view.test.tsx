/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { StreamsView } from './streams_view';

const mockSetStreamEnabled = jest.fn();

jest.mock('../../../../components/search_bar', () => ({
  SignificantEventsSearchBar: () => <div data-test-subj="significantEventsSearchBarMock" />,
}));

jest.mock('../../../../hooks/use_ai_features', () => ({
  useAIFeatures: () => ({
    genAiConnectors: { connectors: [{ connectorId: 'c1' }], loading: false, error: undefined },
  }),
}));

jest.mock('../../../../hooks/use_significant_events_maintenance', () => ({
  useBlocksNewActivity: () => ({ blocksActivity: false, activityBlockTooltip: undefined }),
}));

jest.mock('../../hooks/use_nightshift_stream_enabled', () => ({
  useNightshiftStreamEnabled: () => ({
    isStreamEnabled: () => false,
    isStreamTogglePending: () => false,
    setStreamEnabled: mockSetStreamEnabled,
  }),
}));

jest.mock('../knowledge_indicators_table/ki_generation_context', () => ({
  useKiGeneration: () => ({
    filteredStreams: [],
    isStreamsLoading: false,
    streamStatusMap: {},
    cancelOnboarding: jest.fn(),
    bulkScheduleOnboarding: jest.fn(),
    bulkOnboardAll: jest.fn(),
  }),
}));

jest.mock('./add_data_source_button', () => ({
  AddDataSourceButton: () => <button type="button">Add Data Source</button>,
}));

jest.mock('./tree_table', () => ({
  StreamsTreeTable: () => <div data-test-subj="streamsTable" />,
}));

describe('StreamsView', () => {
  it('keeps Add Data Source and does not render the Generate split button', () => {
    render(<StreamsView />);

    expect(screen.getByText('Add Data Source')).toBeInTheDocument();
    expect(screen.queryByTestId('significant_events_generate_split_button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('significant_events_onboard_streams_button')).not.toBeInTheDocument();
  });
});
