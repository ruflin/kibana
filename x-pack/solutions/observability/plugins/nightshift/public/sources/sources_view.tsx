/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiButton, EuiEmptyPrompt, EuiFlexGroup, EuiFlexItem, EuiText } from '@elastic/eui';
import type { NightshiftSource } from '@kbn/nightshift-shared';
import React, { useEffect, useState } from 'react';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import { getNightshiftCapabilities } from '@kbn/nightshift-shared';
import { LoadingPanel } from '../components/ui/loading_panel';
import { useAIFeatures } from '../data/connectors/use_ai_features';
import { useKibana } from '../hooks/use_kibana';
import { useSourcesApi } from '../data/sources/use_sources_api';
import { useSignificantEventsPageContext } from '../data/discovery/significant_events_page_context';
import type { SignificantEventsSearchBarProps } from '../components/search_bar';
import { SignificantEventsSearchBar } from '../components/search_bar';
import { useBlocksNewActivity } from '../data/maintenance/use_significant_events_maintenance';
import { useKiGeneration } from './onboarding/ki_generation_context';
import { FindSignificantEventsButton } from './find_significant_events_button';
import type { GenerateRun, RowGenerateProps } from './onboarding/types';
import { ConfirmSourceActionModal, type SourceAction } from './confirm_source_action_modal';
import { SourcesTable } from './sources_table';
import {
  CREATE_SOURCE_BUTTON_LABEL,
  EMPTY_STATE_BODY,
  EMPTY_STATE_TITLE,
  READ_ONLY_EMPTY_STATE_TITLE,
  RETRY_LABEL,
  SOURCES_LOAD_ERROR_BODY,
  SOURCES_LOAD_ERROR_TITLE,
  getSourcesCountLabel,
  SOURCES_TABLE_SEARCH_PLACEHOLDER,
  SOURCE_NOT_FOUND_TOAST_TITLE,
} from './translations';

const SourceFlyout = React.lazy(() =>
  import('./source_flyout/source_flyout').then(({ SourceFlyout: Flyout }) => ({ default: Flyout }))
);

/** Source catalog with bulk onboarding controls and a routed create/edit flyout. */
export function SourcesView() {
  const {
    application: {
      capabilities: { nightshift },
    },
    notifications: { toasts },
  } = useKibana().services;
  const { canManage } = getNightshiftCapabilities(nightshift);
  const { blocksActivity, activityBlockTooltip } = useBlocksNewActivity();
  const [searchText, setSearchText] = useState('');

  const {
    sources,
    isSourcesLoading,
    isSourcesFetching,
    isSourcesError,
    refetchSources,
    isScheduling,
    onboardingConfig,
    setOnboardingConfig,
    featuresConnectors,
    queriesConnectors,
    generatingSourceIds,
    awaitingRunSourceIds,
    sourceStatusMap,
    cancelOnboarding,
    bulkOnboardAll,
    bulkOnboardFeaturesOnly,
    bulkOnboardQueriesOnly,
  } = useKiGeneration();
  const { setSourceEnabled, deleteSource } = useSourcesApi();

  const aiFeatures = useAIFeatures();
  const allConnectors = aiFeatures?.genAiConnectors?.connectors ?? [];
  const connectorError = aiFeatures?.genAiConnectors?.error;
  const isConnectorCatalogUnavailable =
    !allConnectors.length || !!aiFeatures?.genAiConnectors?.loading || !!connectorError;

  const { isRunning, isCanceling, handleRun, handleCancel } = useSignificantEventsPageContext();

  const { sourceId } = useParams<{ sourceId?: string }>();
  const history = useHistory();
  const { search } = useLocation();
  const isCreating = sourceId === 'new';
  const routedSource =
    sourceId !== undefined && !isCreating ? sources.find(({ id }) => id === sourceId) : undefined;

  const openCreateFlyout = () => history.push({ pathname: '/sources/new', search });
  const openSource = (source: NightshiftSource) =>
    history.push({ pathname: `/sources/${source.id}`, search });
  const closeFlyout = () => history.push({ pathname: '/sources', search });

  useEffect(() => {
    if (isCreating && !canManage) {
      history.replace({ pathname: '/sources', search });
    }
  }, [canManage, history, isCreating, search]);

  useEffect(() => {
    // A cached list can predate the linked source, so wait for any refetch to finish too.
    if (
      sourceId === undefined ||
      isCreating ||
      isSourcesLoading ||
      isSourcesFetching ||
      isSourcesError ||
      routedSource
    ) {
      return;
    }
    toasts.addWarning({ title: SOURCE_NOT_FOUND_TOAST_TITLE });
    history.replace({ pathname: '/sources', search });
  }, [
    history,
    isCreating,
    isSourcesError,
    isSourcesFetching,
    isSourcesLoading,
    routedSource,
    search,
    sourceId,
    toasts,
  ]);
  const [pendingAction, setPendingAction] = useState<{
    action: SourceAction;
    source: NightshiftSource;
  }>();

  const rowGenerateActions: Record<GenerateRun, (sourceIds: string[]) => Promise<string[]>> = {
    all: bulkOnboardAll,
    features: bulkOnboardFeaturesOnly,
    queries: bulkOnboardQueriesOnly,
  };
  const rowGenerate: RowGenerateProps = {
    config: onboardingConfig,
    allConnectors,
    featuresResolvedConnectorId: featuresConnectors.resolvedConnectorId,
    queriesResolvedConnectorId: queriesConnectors.resolvedConnectorId,
    isRunDisabled:
      blocksActivity ||
      isConnectorCatalogUnavailable ||
      featuresConnectors.loading ||
      queriesConnectors.loading ||
      isScheduling,
    onConfigChange: setOnboardingConfig,
    onRun: (rowSourceId, run) => {
      void rowGenerateActions[run]([rowSourceId]);
    },
  };

  const onConfirmPendingAction = () => {
    if (!pendingAction) {
      return;
    }
    deleteSource.mutate(pendingAction.source, { onSettled: () => setPendingAction(undefined) });
  };

  const handleQueryChange: SignificantEventsSearchBarProps['onQueryChange'] = (queryPayload) => {
    setSearchText(String(queryPayload.query?.query ?? ''));
  };

  // With cached sources, a failed refetch keeps the table; the toast already reports it.
  const hasSourcesLoadFailed = isSourcesError && sources.length === 0;
  const hasNoSources = !isSourcesError && sources.length === 0;

  return (
    <>
      <EuiFlexGroup direction="column" gutterSize="m" data-test-subj="significantEventsAppSources">
        <EuiFlexItem grow={false}>
          <EuiFlexGroup gutterSize="s" alignItems="center" wrap>
            <EuiFlexItem grow style={{ minWidth: 200 }}>
              <SignificantEventsSearchBar
                onQuerySubmit={handleQueryChange}
                onQueryChange={handleQueryChange}
                placeholder={SOURCES_TABLE_SEARCH_PLACEHOLDER}
                query={{
                  query: searchText,
                  language: 'text',
                }}
                showQueryInput
                submitButtonStyle="iconOnly"
                isClearable
              />
            </EuiFlexItem>
            {canManage && (
              <EuiFlexItem grow={false}>
                <EuiButton
                  data-test-subj="significantEventsAppCreateSourceButton"
                  size="s"
                  iconType="plus"
                  onClick={openCreateFlyout}
                >
                  {CREATE_SOURCE_BUTTON_LABEL}
                </EuiButton>
              </EuiFlexItem>
            )}
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

        {isSourcesLoading ? (
          <EuiFlexItem data-test-subj="significantEventsAppSourcesLoading">
            <LoadingPanel size="l" />
          </EuiFlexItem>
        ) : hasSourcesLoadFailed ? (
          <EuiFlexItem>
            <EuiEmptyPrompt
              data-test-subj="significantEventsAppSourcesLoadErrorPrompt"
              color="danger"
              iconType="error"
              title={<h2>{SOURCES_LOAD_ERROR_TITLE}</h2>}
              body={<p>{SOURCES_LOAD_ERROR_BODY}</p>}
              actions={
                <EuiButton
                  data-test-subj="significantEventsAppSourcesLoadErrorRetryButton"
                  onClick={() => refetchSources()}
                >
                  {RETRY_LABEL}
                </EuiButton>
              }
            />
          </EuiFlexItem>
        ) : hasNoSources ? (
          <EuiFlexItem>
            <EuiEmptyPrompt
              data-test-subj="significantEventsAppSourcesEmptyPrompt"
              iconType="database"
              title={<h2>{canManage ? EMPTY_STATE_TITLE : READ_ONLY_EMPTY_STATE_TITLE}</h2>}
              body={<p>{EMPTY_STATE_BODY}</p>}
              actions={
                canManage && (
                  <EuiButton
                    data-test-subj="significantEventsAppSourcesEmptyPromptCreateButton"
                    fill
                    iconType="plus"
                    onClick={openCreateFlyout}
                  >
                    {CREATE_SOURCE_BUTTON_LABEL}
                  </EuiButton>
                )
              }
            />
          </EuiFlexItem>
        ) : (
          <>
            <EuiFlexItem grow={false}>
              <EuiText size="s">{getSourcesCountLabel(sources.length)}</EuiText>
            </EuiFlexItem>
            <EuiFlexItem>
              <SourcesTable
                sources={sources}
                onboardingResultMap={sourceStatusMap}
                searchText={searchText}
                blocksActivity={blocksActivity}
                generatingSourceIds={generatingSourceIds}
                awaitingRunSourceIds={awaitingRunSourceIds}
                activityBlockTooltip={activityBlockTooltip}
                canManage={canManage}
                pendingEnabledSourceId={
                  setSourceEnabled.isLoading ? setSourceEnabled.variables?.sourceId : undefined
                }
                onOpenSource={openSource}
                onToggleSourceEnabled={(source, enabled) =>
                  setSourceEnabled.mutate({ sourceId: source.id, enabled })
                }
                generate={rowGenerate}
                onStopOnboarding={cancelOnboarding}
                onDeleteSource={(source) => setPendingAction({ action: 'delete', source })}
              />
            </EuiFlexItem>
          </>
        )}
      </EuiFlexGroup>

      {((isCreating && canManage) || routedSource) && (
        <React.Suspense fallback={null}>
          <SourceFlyout
            key={routedSource?.id ?? 'new'}
            source={routedSource}
            readOnly={!canManage}
            onClose={closeFlyout}
          />
        </React.Suspense>
      )}
      {pendingAction && (
        <ConfirmSourceActionModal
          action={pendingAction.action}
          source={pendingAction.source}
          isLoading={deleteSource.isLoading}
          onCancel={() => setPendingAction(undefined)}
          onConfirm={onConfirmPendingAction}
        />
      )}
    </>
  );
}
