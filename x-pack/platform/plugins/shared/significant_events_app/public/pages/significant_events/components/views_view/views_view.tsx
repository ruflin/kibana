/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiButton, EuiFlexGroup, EuiFlexItem, EuiText } from '@elastic/eui';
import { KIS_ONBOARDING_IN_PROGRESS_STATUSES } from '@kbn/significant-events-schema';
import React, { useMemo, useState } from 'react';
import { useKibana } from '../../../../hooks/use_kibana';
import { useAIFeatures } from '../../../../hooks/use_ai_features';
import { useBlocksNewActivity } from '../../../../hooks/use_significant_events_maintenance';
import { SignificantEventsSearchBar } from '../../../../components/search_bar';
import type { SignificantEventsSearchBarProps } from '../../../../components/search_bar';
import { GenerateSplitButton } from '../shared/generate_split_button';
import { FindSignificantEventsButton } from '../streams_view/find_significant_events_button';
import { useSignificantEventsPageContext } from '../../context/significant_events_page_context';
import { useKiGeneration } from '../knowledge_indicators_table/ki_generation_context';
import { useDataViewsApi, useFetchDataViews } from '../../hooks/use_data_views';
import { AddExistingViewFlyout, CreateViewFlyout } from './add_view_flyouts';
import { ViewsTable } from './views_table';
import {
  ADD_EXISTING_VIEW_BUTTON,
  CREATE_VIEW_BUTTON,
  GENERATE_DISABLED_TOOLTIP,
  VIEWS_COUNT_LABEL,
  VIEWS_SEARCH_PLACEHOLDER,
} from './translations';

type FlyoutMode = 'add' | 'create' | null;

export function ViewsView() {
  const {
    core: {
      application: {
        capabilities: { streams },
      },
    },
  } = useKibana();
  const canManage = streams?.manage === true;

  const { blocksActivity, activityBlockTooltip } = useBlocksNewActivity();
  const [searchText, setSearchText] = useState('');
  const [flyout, setFlyout] = useState<FlyoutMode>(null);

  const viewsQuery = useFetchDataViews();
  const views = useMemo(() => viewsQuery.data?.views ?? [], [viewsQuery.data?.views]);
  const { addExisting, createOwned, setEnabled, remove } = useDataViewsApi();

  const {
    isScheduling,
    onboardingConfig,
    setOnboardingConfig,
    featuresConnectors,
    queriesConnectors,
    generatingStreamNames,
    streamStatusMap,
    bulkOnboardAll,
    bulkOnboardFeaturesOnly,
    bulkOnboardQueriesOnly,
  } = useKiGeneration();

  const aiFeatures = useAIFeatures();
  const allConnectors = aiFeatures?.genAiConnectors?.connectors ?? [];
  const connectorError = aiFeatures?.genAiConnectors?.error;
  const isConnectorCatalogUnavailable =
    !allConnectors.length || !!aiFeatures?.genAiConnectors?.loading || !!connectorError;

  const { isRunning, isCanceling, handleRun, handleCancel } = useSignificantEventsPageContext();

  const configuredNames = useMemo(() => new Set(views.map((view) => view.name)), [views]);

  const enabledActionableNames = useMemo(
    () =>
      views
        .filter((view) => view.enabled)
        .filter((view) => !generatingStreamNames.includes(view.name))
        .filter((view) => {
          const result = streamStatusMap[view.name];
          return !result || !KIS_ONBOARDING_IN_PROGRESS_STATUSES.has(result.status);
        })
        .map((view) => view.name),
    [views, generatingStreamNames, streamStatusMap]
  );

  const handleQueryChange: SignificantEventsSearchBarProps['onQueryChange'] = (queryPayload) => {
    setSearchText(String(queryPayload.query?.query ?? ''));
  };

  return (
    <EuiFlexGroup direction="column" gutterSize="m">
      <EuiFlexItem grow={false}>
        <EuiFlexGroup gutterSize="s" alignItems="center" wrap>
          <EuiFlexItem grow style={{ minWidth: 200 }}>
            <SignificantEventsSearchBar
              onQuerySubmit={handleQueryChange}
              onQueryChange={handleQueryChange}
              placeholder={VIEWS_SEARCH_PLACEHOLDER}
              query={{ query: searchText, language: 'text' }}
              showDatePicker
              showQueryInput
              enableDateRangePicker
              submitButtonStyle="iconOnly"
              isClearable
            />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton
              size="s"
              iconType="plusInCircle"
              onClick={() => setFlyout('add')}
              isDisabled={!canManage}
              data-test-subj="significantEventsAddExistingViewButton"
            >
              {ADD_EXISTING_VIEW_BUTTON}
            </EuiButton>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton
              size="s"
              iconType="plusInCircleFilled"
              fill
              onClick={() => setFlyout('create')}
              isDisabled={!canManage}
              data-test-subj="significantEventsCreateViewButton"
            >
              {CREATE_VIEW_BUTTON}
            </EuiButton>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <GenerateSplitButton
              size="s"
              config={onboardingConfig}
              allConnectors={allConnectors}
              connectorError={connectorError}
              featuresResolvedConnectorId={featuresConnectors.resolvedConnectorId}
              queriesResolvedConnectorId={queriesConnectors.resolvedConnectorId}
              onConfigChange={setOnboardingConfig}
              onRun={() => bulkOnboardAll(enabledActionableNames)}
              onRunFeaturesOnly={() => bulkOnboardFeaturesOnly(enabledActionableNames)}
              onRunQueriesOnly={() => bulkOnboardQueriesOnly(enabledActionableNames)}
              isRunDisabled={
                blocksActivity ||
                enabledActionableNames.length === 0 ||
                isConnectorCatalogUnavailable ||
                featuresConnectors.loading ||
                queriesConnectors.loading ||
                isScheduling
              }
              runDisabledTooltip={
                views.length > 0 && enabledActionableNames.length === 0
                  ? GENERATE_DISABLED_TOOLTIP
                  : activityBlockTooltip
              }
              isConfigDisabled={enabledActionableNames.length === 0}
              isLoading={isScheduling}
            />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <FindSignificantEventsButton
              onRun={handleRun}
              onCancel={handleCancel}
              isRunning={isRunning}
              isCanceling={isCanceling}
              isDisabled={isRunning || blocksActivity}
              disabledTooltip={activityBlockTooltip}
            />
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>

      <EuiFlexItem grow={false}>
        <EuiText size="s">{VIEWS_COUNT_LABEL(views.length)}</EuiText>
      </EuiFlexItem>

      <EuiFlexItem>
        <ViewsTable
          views={views}
          searchText={searchText}
          loading={viewsQuery.isLoading}
          streamStatusMap={streamStatusMap}
          canManage={canManage}
          onToggle={(name, enabled) => setEnabled.mutate({ name, enabled })}
          onRemove={(name) => remove.mutate(name)}
        />
      </EuiFlexItem>

      {flyout === 'add' && (
        <AddExistingViewFlyout
          configuredNames={configuredNames}
          isLoading={addExisting.isLoading}
          onClose={() => setFlyout(null)}
          onAdd={(name) => addExisting.mutateAsync(name)}
        />
      )}
      {flyout === 'create' && (
        <CreateViewFlyout
          isLoading={createOwned.isLoading}
          onClose={() => setFlyout(null)}
          onCreate={(params) => createOwned.mutateAsync(params)}
        />
      )}
    </EuiFlexGroup>
  );
}
