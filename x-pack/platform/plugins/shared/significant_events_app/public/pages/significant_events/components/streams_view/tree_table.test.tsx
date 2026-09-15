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

describe('StreamsTreeTable', () => {
  it('keeps Name, Enabled, Status, and KI Features, and drops KI Queries, Events, and Actions', () => {
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
    expect(screen.getByRole('columnheader', { name: 'Enabled' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'KI Features' })).toBeInTheDocument();

    expect(screen.queryByRole('columnheader', { name: 'KI Queries' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^Events/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();

    expect(
      screen.getByTestId('significantEventsStreamEnabledSwitch-logs-generic-default')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Onboard stream')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Stop stream onboarding')).not.toBeInTheDocument();
  });
});
