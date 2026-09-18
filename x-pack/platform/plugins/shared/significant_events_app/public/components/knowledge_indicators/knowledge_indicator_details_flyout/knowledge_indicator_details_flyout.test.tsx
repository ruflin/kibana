/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@kbn/i18n-react';
import type { KnowledgeIndicator } from '@kbn/nightshift-ai';
import type { Feature, StreamQuery } from '@kbn/significant-events-schema';
import { useDeveloperMode } from '../../../hooks/use_developer_mode';
import { KnowledgeIndicatorDetailsFlyout } from './knowledge_indicator_details_flyout';

jest.mock('../../../hooks/use_developer_mode');
jest.mock('../../../hooks/use_kibana', () => ({
  useKibana: () => ({
    core: {
      application: {
        capabilities: {
          nightshift: {
            manage: true,
          },
        },
      },
    },
    dependencies: {
      start: {
        share: {
          url: {
            locators: {
              get: jest.fn(),
            },
          },
        },
      },
    },
  }),
}));
jest.mock('../../../hooks/use_timefilter', () => ({
  useTimefilter: () => ({
    timeState: { start: 0, end: 1 },
  }),
}));
jest.mock('../hooks/use_knowledge_indicator_actions', () => ({
  useKnowledgeIndicatorActions: () => ({
    excludeFeature: jest.fn(),
    restoreFeature: jest.fn(),
    promoteQuery: jest.fn(),
    setDurability: jest.fn(),
    isMutating: false,
  }),
  DELETE_LABEL: 'Delete',
  EXCLUDE_LABEL: 'Exclude',
  RESTORE_LABEL: 'Restore',
  PROMOTE_LABEL: 'Promote',
}));
jest.mock('../hooks/use_stream_knowledge_indicators_bulk_delete', () => ({
  useStreamKnowledgeIndicatorsBulkDelete: () => ({
    deleteKnowledgeIndicatorsInBulk: jest.fn(),
    isDeleting: false,
  }),
}));
jest.mock('../hooks/use_rules_demote', () => ({
  useRulesDemote: () => ({
    demoteRules: jest.fn(),
    isPending: false,
  }),
}));
jest.mock('../../../hooks/use_significant_events_maintenance', () => ({
  useBlocksNewActivity: () => ({
    blocksActivity: false,
    activityBlockTooltip: undefined,
  }),
}));
jest.mock('../../flyout_components/flyout_toolbar_header', () => ({
  FlyoutToolbarHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseDeveloperMode = useDeveloperMode as jest.MockedFunction<typeof useDeveloperMode>;

const makeFeature = (): Feature => ({
  id: 'feature-id',
  uuid: 'feature-uuid',
  stream_name: 'logs.test',
  type: 'entity',
  description: 'A feature',
  properties: {},
  confidence: 90,
  updated_at: '2026-01-01T00:00:00.000Z',
});

const makeFeatureKI = (): KnowledgeIndicator => ({
  kind: 'feature',
  feature: makeFeature(),
});

const makeQuery = (): StreamQuery => ({
  id: 'query-id',
  type: 'match',
  title: 'Query title',
  description: 'A query',
  esql: { query: 'FROM logs-*' },
});

const makeQueryKI = (): KnowledgeIndicator => ({
  kind: 'query',
  query: makeQuery(),
  rule: { backed: false, id: 'rule-1' },
  stream_name: 'logs.test',
});

const renderFlyout = (knowledgeIndicator: KnowledgeIndicator, isDeveloperMode: boolean) => {
  mockUseDeveloperMode.mockReturnValue({
    isDeveloperMode,
    setDeveloperMode: jest.fn(),
    canEditDeveloperMode: true,
  });

  return render(
    <I18nProvider>
      <KnowledgeIndicatorDetailsFlyout
        knowledgeIndicator={knowledgeIndicator}
        occurrencesByQueryId={{}}
        onClose={jest.fn()}
        features={[]}
      />
    </I18nProvider>
  );
};

describe('KnowledgeIndicatorDetailsFlyout developer mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hides the def tab and raw document JSON when developer mode is off', () => {
    renderFlyout(makeFeatureKI(), false);

    expect(screen.queryByTestId('nightshiftKnowledgeIndicatorDefTab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nightshiftKnowledgeIndicatorDefJson')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('significantEventsAppFeatureDetailsFlyoutRawDocument')
    ).not.toBeInTheDocument();
    expect(screen.getByText('A feature')).toBeInTheDocument();
  });

  it('shows the full knowledge indicator JSON on the def tab for a feature', () => {
    const knowledgeIndicator = makeFeatureKI();
    renderFlyout(knowledgeIndicator, true);

    const defTab = screen.getByTestId('nightshiftKnowledgeIndicatorDefTab');
    expect(defTab).toHaveTextContent('Dev');
    expect(
      defTab.querySelector('[data-test-subj="nightshiftDeveloperModeBadge"]')
    ).toBeInTheDocument();

    fireEvent.click(defTab);

    expect(
      JSON.parse(screen.getByTestId('nightshiftKnowledgeIndicatorDefJson').textContent ?? '')
    ).toEqual(knowledgeIndicator);
    expect(
      screen.queryByTestId('significantEventsAppFeatureDetailsFlyoutRawDocument')
    ).not.toBeInTheDocument();
  });

  it('shows the full knowledge indicator JSON on the def tab for a query', () => {
    const knowledgeIndicator = makeQueryKI();
    renderFlyout(knowledgeIndicator, true);

    expect(screen.queryByTestId('nightshiftKnowledgeIndicatorDefJson')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('nightshiftKnowledgeIndicatorDefTab'));

    expect(
      JSON.parse(screen.getByTestId('nightshiftKnowledgeIndicatorDefJson').textContent ?? '')
    ).toEqual(knowledgeIndicator);
  });
});
