/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@kbn/i18n-react';
import { SourcesPage } from './page';

const mockAppHeader = jest.fn();
jest.mock('../components/app_header', () => ({
  NightshiftAppHeader: (props: unknown) => {
    mockAppHeader(props);
    return <div data-test-subj="sourcesHeaderStub" />;
  },
}));
jest.mock('./sources_view', () => ({
  SourcesView: () => <div data-test-subj="sourcesViewStub" />,
}));
jest.mock('../data/maintenance/use_significant_events_maintenance', () => ({
  useBlocksNewActivity: () => ({
    isBlocked: false,
    isLoading: false,
    isError: false,
    status: undefined,
  }),
}));
jest.mock('../data/discovery/significant_events_page_context', () => ({
  SignificantEventsPageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('./onboarding/ki_generation_context', () => ({
  KiGenerationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('../hooks/use_kibana', () => ({
  useKibana: () => ({
    services: {
      application: {
        capabilities: { nightshift: {} },
        getUrlForApp: (_appId: string, { path }: { path: string }) => `/app/nightshift${path}`,
      },
      notifications: { toasts: { addError: jest.fn() } },
    },
  }),
}));

describe('SourcesPage', () => {
  beforeEach(() => {
    mockAppHeader.mockClear();
  });

  it('links Back from Sources to Detections', () => {
    render(
      <I18nProvider>
        <SourcesPage headerProps={{}} />
      </I18nProvider>
    );

    expect(screen.getByTestId('sourcesViewStub')).toBeInTheDocument();
    expect(mockAppHeader.mock.lastCall[0]).toMatchObject({
      page: 'sources',
      back: { href: '/app/nightshift/detections/events', label: 'Detections' },
    });
  });
});
