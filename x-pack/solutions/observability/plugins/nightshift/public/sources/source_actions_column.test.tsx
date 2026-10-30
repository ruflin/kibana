/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { InferenceConnector } from '@kbn/inference-common';
import { InferenceConnectorType } from '@kbn/inference-common';
import type { NightshiftSource } from '@kbn/nightshift-shared';
import { KIsOnboardingStep, SignificantEventsWorkflowStatus } from '@kbn/significant-events-schema';
import { useKibana } from '../hooks/use_kibana';
import { SourceActionsColumn } from './source_actions_column';
import type { OnboardingConfig } from './onboarding/types';

jest.mock('../hooks/use_kibana');

const mockUseKibana = useKibana as jest.MockedFunction<typeof useKibana>;

const SOURCE: NightshiftSource = {
  id: 'source-1',
  title: 'Nginx errors',
  tags: [],
  esql: 'FROM logs-nginx-*',
  type: 'logs',
  slug: 'nginx-errors',
  view_name: '$.nightshift.sources.default.nginx-errors',
  enabled: true,
  created_by: 'marco',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  esql_updated_at: '2026-09-01T00:00:00.000Z',
};

const createConnector = (connectorId: string, name: string): InferenceConnector => ({
  connectorId,
  name,
  type: InferenceConnectorType.Inference,
  config: {},
  capabilities: {},
  isInferenceEndpoint: true,
  isPreconfigured: true,
});

const featuresConnector = createConnector('features-model', 'Features model');
const queriesConnector = createConnector('queries-model', 'Queries model');
const replacementConnector = createConnector('replacement-model', 'Replacement model');

const baseConfig: OnboardingConfig = {
  steps: [KIsOnboardingStep.FeaturesIdentification, KIsOnboardingStep.QueriesGeneration],
  connectors: {
    features: featuresConnector.connectorId,
    queries: queriesConnector.connectorId,
  },
};

const renderActions = ({
  overrides = {},
  generateOverrides = {},
  defaultConnectorOnly = false,
}: {
  overrides?: Partial<React.ComponentProps<typeof SourceActionsColumn>>;
  generateOverrides?: Partial<React.ComponentProps<typeof SourceActionsColumn>['generate']>;
  defaultConnectorOnly?: boolean;
} = {}) => {
  mockUseKibana.mockReturnValue({
    services: {
      settings: {
        client: {
          get: jest.fn().mockReturnValue(defaultConnectorOnly),
        },
      },
    },
  } as never);

  const props = {
    source: SOURCE,
    blocksActivity: false,
    isOnboardPending: false,
    onboardTooltip: 'Onboard source',
    onStopOnboarding: jest.fn(),
    onDelete: jest.fn(),
    ...overrides,
    generate: {
      config: baseConfig,
      allConnectors: [featuresConnector, queriesConnector, replacementConnector],
      featuresResolvedConnectorId: featuresConnector.connectorId,
      queriesResolvedConnectorId: queriesConnector.connectorId,
      isRunDisabled: false,
      onConfigChange: jest.fn(),
      onRun: jest.fn(),
      ...generateOverrides,
    },
  };
  const view = render(<SourceActionsColumn {...props} />);
  return { ...view, props };
};

const openMenu = () => {
  fireEvent.click(screen.getByTestId('significantEventsAppSourcesTableActionsButton'));
};

describe('SourceActionsColumn', () => {
  it('runs all steps for the source from the menu and closes it', async () => {
    const { props } = renderActions();

    openMenu();
    fireEvent.click(screen.getByTestId('significantEventsAppSourceGenerateAll'));

    expect(props.generate.onRun).toHaveBeenCalledWith(SOURCE.id, 'all');
    await waitFor(() => {
      expect(screen.queryByTestId('significantEventsAppSourceGenerateAll')).not.toBeInTheDocument();
    });
  });

  it.each([
    { testSubj: 'significantEventsAppSourceGenerateFeatures', run: 'features' },
    { testSubj: 'significantEventsAppSourceGenerateQueries', run: 'queries' },
  ])('runs $run only from the menu', ({ testSubj, run }) => {
    const { props } = renderActions();

    openMenu();
    fireEvent.click(screen.getByTestId(testSubj));

    expect(props.generate.onRun).toHaveBeenCalledWith(SOURCE.id, run);
  });

  it('disables every generate run for a disabled source and explains why', () => {
    renderActions({ overrides: { source: { ...SOURCE, enabled: false } } });

    openMenu();

    expect(screen.getByTestId('significantEventsAppSourceGenerateAll')).toBeDisabled();
    expect(screen.getByTestId('significantEventsAppSourceGenerateFeatures')).toBeDisabled();
    expect(screen.getByTestId('significantEventsAppSourceGenerateQueries')).toBeDisabled();
  });

  it('disables only the run whose model is missing', () => {
    renderActions({
      generateOverrides: {
        config: { ...baseConfig, connectors: { queries: queriesConnector.connectorId } },
      },
    });

    openMenu();

    expect(screen.getByTestId('significantEventsAppSourceGenerateAll')).toBeDisabled();
    expect(screen.getByTestId('significantEventsAppSourceGenerateFeatures')).toBeDisabled();
    expect(screen.getByTestId('significantEventsAppSourceGenerateQueries')).toBeEnabled();
  });

  it('shows stop instead of generate while a run is in progress', () => {
    const { props } = renderActions({
      overrides: { onboardingStatus: SignificantEventsWorkflowStatus.InProgress },
    });

    openMenu();

    expect(screen.getByTestId('significantEventsAppSourceGenerateAll')).toBeDisabled();
    fireEvent.click(screen.getByTestId('significantEventsAppSourcesTableStopButton'));
    expect(props.onStopOnboarding).toHaveBeenCalledWith(SOURCE.id);
  });

  it('shows a disabled stop while a run is expected but not reported yet', () => {
    renderActions({
      overrides: {
        isOnboardPending: true,
        onboardingStatus: SignificantEventsWorkflowStatus.Completed,
      },
    });

    openMenu();

    expect(screen.getByTestId('significantEventsAppSourcesTableStopButton')).toBeDisabled();
    expect(screen.getByTestId('significantEventsAppSourceGenerateAll')).toBeDisabled();
  });

  it('disables stop from the click and brings it back when cancel fails', async () => {
    let rejectCancel: (error: Error) => void = () => undefined;
    const onStopOnboarding = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCancel = reject;
        })
    );
    renderActions({
      overrides: {
        onboardingStatus: SignificantEventsWorkflowStatus.InProgress,
        onStopOnboarding,
      },
    });

    openMenu();
    fireEvent.click(screen.getByTestId('significantEventsAppSourcesTableStopButton'));

    expect(onStopOnboarding).toHaveBeenCalledTimes(1);

    openMenu();
    const stopItem = screen.getByTestId('significantEventsAppSourcesTableStopButton');
    expect(stopItem).toBeDisabled();

    rejectCancel(new Error('cancel failed'));

    await waitFor(() => {
      expect(screen.getByTestId('significantEventsAppSourcesTableStopButton')).toBeEnabled();
    });
  });

  it('keeps stop disabled after a successful cancel until the run leaves in progress', async () => {
    const onStopOnboarding = jest.fn().mockResolvedValue(undefined);
    const { rerender, props } = renderActions({
      overrides: {
        onboardingStatus: SignificantEventsWorkflowStatus.InProgress,
        onStopOnboarding,
      },
    });

    openMenu();
    fireEvent.click(screen.getByTestId('significantEventsAppSourcesTableStopButton'));

    await waitFor(() => {
      expect(onStopOnboarding).toHaveBeenCalledTimes(1);
    });

    openMenu();
    expect(screen.getByTestId('significantEventsAppSourcesTableStopButton')).toBeDisabled();
    // The button toggles the menu, so this closes it again before the status changes.
    openMenu();

    rerender(
      <SourceActionsColumn {...props} onboardingStatus={SignificantEventsWorkflowStatus.Canceled} />
    );

    openMenu();
    expect(
      screen.queryByTestId('significantEventsAppSourcesTableStopButton')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('significantEventsAppSourceGenerateAll')).toBeEnabled();

    rerender(
      <SourceActionsColumn
        {...props}
        onboardingStatus={SignificantEventsWorkflowStatus.InProgress}
      />
    );

    openMenu();
    expect(screen.getByTestId('significantEventsAppSourcesTableStopButton')).toBeEnabled();
  });

  it('deletes the source from the menu', () => {
    const { props } = renderActions();

    openMenu();
    fireEvent.click(screen.getByTestId('significantEventsAppSourcesTableDeleteButton'));

    expect(props.onDelete).toHaveBeenCalledWith(SOURCE);
  });

  it('changes the features model shared with the generate button and returns to the root panel', async () => {
    const { props } = renderActions();

    openMenu();
    fireEvent.click(screen.getByTestId('significantEventsAppSourceFeaturesModel'));
    // EUI moves into the sub-panel on the next animation frame.
    fireEvent.click(await screen.findByText(replacementConnector.name));

    expect(props.generate.onConfigChange).toHaveBeenCalledWith({
      ...baseConfig,
      connectors: { ...baseConfig.connectors, features: replacementConnector.connectorId },
    });
    expect(await screen.findByTestId('significantEventsAppSourceGenerateAll')).toBeInTheDocument();
  });

  it('shows the configured default model callout in the model panel', async () => {
    renderActions({ defaultConnectorOnly: true });

    openMenu();
    fireEvent.click(screen.getByTestId('significantEventsAppSourceQueriesModel'));

    const panel = await screen.findByTestId('significant_events_default_connector_only_callout');
    expect(within(panel).getByText('Configured default model only')).toBeInTheDocument();
  });
});
