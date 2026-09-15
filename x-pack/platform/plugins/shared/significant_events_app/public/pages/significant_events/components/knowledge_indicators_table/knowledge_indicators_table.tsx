/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  EuiCallOut,
  EuiEmptyPrompt,
  EuiFlexGroup,
  EuiFlexItem,
  EuiHorizontalRule,
  EuiInMemoryTable,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSpacer,
  useEuiTheme,
} from '@elastic/eui';
import { css } from '@emotion/react';
import type { KnowledgeIndicator } from '@kbn/nightshift-ai';
import type { TopologyNode } from '@kbn/significant-events-schema';
import type { Streams } from '@kbn/streams-schema';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAIFeatures } from '../../../../hooks/use_ai_features';
import { getFeaturesFromKIs } from '../../../../components/knowledge_indicators/utils/get_features_from_kis';
import { AssetImage } from '../../../../components/asset_image';
import { LoadingPanel } from '../../../../components/loading_panel';
import { KnowledgeIndicatorDetailsFlyout } from '../../../../components/knowledge_indicators/knowledge_indicator_details_flyout';
import { DeleteTableItemsModal } from '../../../../components/knowledge_indicators/delete_table_items_modal';
import { getKnowledgeIndicatorItemId } from '../../../../components/knowledge_indicators/utils/get_knowledge_indicator_item_id';
import { getKnowledgeIndicatorStreamName } from '../../../../components/knowledge_indicators/utils/get_knowledge_indicator_stream_name';
import { GenerateSplitButton } from '../shared/generate_split_button';
import { StreamPicker } from '../shared/stream_picker';
import { useBlocksNewActivity } from '../../../../hooks/use_significant_events_maintenance';
import { useKiGeneration } from './ki_generation_context';
import { useKnowledgeIndicatorsTable } from './use_knowledge_indicators_table';
import { useKnowledgeIndicatorsColumns } from './use_knowledge_indicators_columns';
import { KnowledgeIndicatorsToolbar } from './knowledge_indicators_toolbar';
import { TopologyMapAccordion } from '../../../../components/knowledge_indicators/topology_map';
import { GenerateTopologyButton } from './generate_topology_button';
import { useGenerateTopology } from './use_generate_topology';
import { getFormattedError } from '../../../../util/errors';
import type { KnowledgeIndicatorView } from '../../../../components/knowledge_indicators/utils/get_knowledge_indicator_view';
import {
  TABLE_CAPTION,
  NO_ITEMS_MESSAGE,
  EMPTY_STATE_TITLE,
  EMPTY_STATE_DESCRIPTION,
  DELETE_MODAL_TITLE,
  HIDDEN_COMPUTED_FEATURES_HINT,
  GENERATION_IN_PROGRESS_TITLE,
  getGenerationInProgressDescription,
  GENERATING_TOPOLOGY_TITLE,
  GENERATING_TOPOLOGY_DESCRIPTION,
  GENERATE_TOPOLOGY_ERROR_TITLE,
} from './translations';

export function KnowledgeIndicatorsTable({ view }: { view: KnowledgeIndicatorView }) {
  const { euiTheme } = useEuiTheme();
  const { blocksActivity, activityBlockTooltip } = useBlocksNewActivity();
  const [generationStreamNames, setGenerationStreamNames] = useState<string[]>([]);

  const {
    filteredStreams,
    isStreamsLoading,
    generatingStreamNames,
    isGenerating,
    isInitialGenerationStatusLoading,
    isScheduling,
    onboardingConfig,
    setOnboardingConfig,
    featuresConnectors,
    queriesConnectors,
    bulkOnboardAll,
    bulkOnboardFeaturesOnly,
    bulkOnboardQueriesOnly,
  } = useKiGeneration();

  const aiFeatures = useAIFeatures();
  const allConnectors = aiFeatures?.genAiConnectors?.connectors ?? [];
  const connectorError = aiFeatures?.genAiConnectors?.error;
  const isConnectorCatalogUnavailable =
    !allConnectors.length || !!aiFeatures?.genAiConnectors?.loading || !!connectorError;

  const runAndClearPicker = useCallback(
    async (action: (names: string[]) => Promise<string[]>) => {
      const names = generationStreamNames;
      setGenerationStreamNames([]);
      await action(names);
    },
    [generationStreamNames]
  );

  const onRunGeneration = useCallback(
    async () => runAndClearPicker(bulkOnboardAll),
    [runAndClearPicker, bulkOnboardAll]
  );
  const onRunFeaturesOnly = useCallback(
    async () => runAndClearPicker(bulkOnboardFeaturesOnly),
    [runAndClearPicker, bulkOnboardFeaturesOnly]
  );
  const onRunQueriesOnly = useCallback(
    async () => runAndClearPicker(bulkOnboardQueriesOnly),
    [runAndClearPicker, bulkOnboardQueriesOnly]
  );

  const isRunDisabled =
    blocksActivity ||
    generationStreamNames.length === 0 ||
    isConnectorCatalogUnavailable ||
    featuresConnectors.loading ||
    queriesConnectors.loading ||
    isScheduling;

  const {
    knowledgeIndicators,
    occurrencesByQueryId,
    isLoading,
    isEmpty,
    refetch,
    filteredKnowledgeIndicators,
    selectedKnowledgeIndicator,
    selectedKnowledgeIndicatorId,
    selectedKnowledgeIndicators,
    setSelectedKnowledgeIndicators,
    knowledgeIndicatorsToDelete,
    setKnowledgeIndicatorsToDelete,
    pagination,
    isDeleting,
    isBulkOperationInProgress,
    isBulkPromoteInProgress,
    isOperationInProgress,
    selectionContainsNonExcludable,
    hasPromotableSelected,
    isSelectionActionsDisabled,
    hasOnlyHiddenComputedFeatures,
    tableSearchValue,
    debouncedSearchTerm,
    statusFilter,
    selectedTypes,
    selectedSubtypes,
    selectedStreams,
    hideComputedTypes,
    handleStatusFilterChange,
    handleSelectedTypesChange,
    handleSelectedSubtypesChange,
    handleSelectedStreamsChange,
    handleComputedToggleChange,
    handleSearchChange,
    handleTableChange,
    handleBulkExclude,
    handleBulkRestore,
    closeFlyout,
    toggleSelectedKnowledgeIndicator,
    selectKnowledgeIndicator,
    deleteKnowledgeIndicatorsInBulk,
    handleBulkPromote,
    goToPageForItemIndex,
  } = useKnowledgeIndicatorsTable(view);

  const {
    generateTopology,
    isGenerating: isGeneratingTopology,
    error: generateTopologyError,
  } = useGenerateTopology();

  const wasGeneratingRef = useRef(false);
  useEffect(() => {
    if (isGenerating) {
      wasGeneratingRef.current = true;
      const id = setInterval(() => refetch(), 10_000);
      return () => clearInterval(id);
    }
    if (wasGeneratingRef.current) {
      wasGeneratingRef.current = false;
      refetch();
    }
  }, [isGenerating, refetch]);

  const features = useMemo(() => getFeaturesFromKIs(knowledgeIndicators), [knowledgeIndicators]);

  const streamsByName = useMemo(() => {
    const map = new Map<string, Streams.all.Definition>();
    filteredStreams?.forEach(({ stream }) => map.set(stream.name, stream));
    return map;
  }, [filteredStreams]);

  const currentIndex = filteredKnowledgeIndicators.findIndex(
    (ki) => getKnowledgeIndicatorItemId(ki) === selectedKnowledgeIndicatorId
  );

  const columns = useKnowledgeIndicatorsColumns({
    occurrencesByQueryId,
    selectedKnowledgeIndicatorId,
    toggleSelectedKnowledgeIndicator,
    setKnowledgeIndicatorsToDelete,
  });

  const handleTopologyNodeClick = useCallback(
    (node: TopologyNode) => {
      const ki = filteredKnowledgeIndicators.find(
        (item) => item.kind === 'feature' && item.feature.uuid === node.id
      );
      if (!ki) {
        return;
      }
      selectKnowledgeIndicator(ki);
    },
    [filteredKnowledgeIndicators, selectKnowledgeIndicator]
  );

  const generationRow = (
    <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} css={{ width: '100%' }}>
      <EuiFlexItem css={{ minWidth: 0 }}>
        <StreamPicker
          streams={filteredStreams}
          isStreamsLoading={isStreamsLoading}
          selectedStreamNames={generationStreamNames}
          onSelectedStreamNamesChange={setGenerationStreamNames}
          excludedStreamNames={generatingStreamNames}
          isDisabled={isScheduling}
          fullWidth
        />
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <GenerateSplitButton
          config={onboardingConfig}
          allConnectors={allConnectors}
          connectorError={connectorError}
          featuresResolvedConnectorId={featuresConnectors.resolvedConnectorId}
          queriesResolvedConnectorId={queriesConnectors.resolvedConnectorId}
          onConfigChange={setOnboardingConfig}
          onRun={onRunGeneration}
          onRunFeaturesOnly={onRunFeaturesOnly}
          onRunQueriesOnly={onRunQueriesOnly}
          isRunDisabled={isRunDisabled}
          runDisabledTooltip={activityBlockTooltip}
          isConfigDisabled={generationStreamNames.length === 0}
          isLoading={isScheduling}
        />
      </EuiFlexItem>
      {view === 'topology' && (
        <EuiFlexItem grow={false}>
          <GenerateTopologyButton
            selectedStreamNames={selectedStreams}
            isLoading={isGeneratingTopology}
            onGenerate={(streamNames) => {
              void generateTopology(streamNames);
            }}
          />
        </EuiFlexItem>
      )}
    </EuiFlexGroup>
  );

  const topologyProgressCallout = isGeneratingTopology ? (
    <>
      <EuiSpacer size="m" />
      <EuiCallOut
        size="s"
        color="primary"
        iconType={EuiLoadingSpinner}
        title={GENERATING_TOPOLOGY_TITLE}
        announceOnMount
        data-test-subj="significantEventsGeneratingTopologyCallout"
      >
        <p>{GENERATING_TOPOLOGY_DESCRIPTION}</p>
      </EuiCallOut>
    </>
  ) : null;

  const topologyErrorCallout = generateTopologyError ? (
    <>
      <EuiSpacer size="m" />
      <EuiCallOut
        size="s"
        color="danger"
        title={GENERATE_TOPOLOGY_ERROR_TITLE}
        announceOnMount
        data-test-subj="significantEventsGenerateTopologyErrorCallout"
      >
        <p>{getFormattedError(generateTopologyError).message}</p>
      </EuiCallOut>
    </>
  ) : null;

  const generationProgressCallout = isGenerating ? (
    <>
      <EuiSpacer size="m" />
      <EuiCallOut
        size="s"
        color="primary"
        iconType={EuiLoadingSpinner}
        title={GENERATION_IN_PROGRESS_TITLE}
        announceOnMount
      >
        <p>{getGenerationInProgressDescription(generatingStreamNames)}</p>
      </EuiCallOut>
    </>
  ) : null;

  if (knowledgeIndicators.length === 0 && (isLoading || isInitialGenerationStatusLoading)) {
    return <LoadingPanel size="l" />;
  }

  if (isEmpty && !isGenerating) {
    return (
      <EuiEmptyPrompt
        aria-live="polite"
        color="plain"
        css={css`
          && {
            max-width: 560px;
          }

          .euiEmptyPrompt__actions {
            width: 100%;
            max-width: 100%;
          }
        `}
        icon={<AssetImage type="knowledgeIndicatorsEmptyState" size={140} />}
        title={<h2>{EMPTY_STATE_TITLE}</h2>}
        body={<p>{EMPTY_STATE_DESCRIPTION}</p>}
        actions={generationRow}
      />
    );
  }

  return (
    <EuiPanel hasBorder hasShadow={false}>
      {generationRow}
      {generationProgressCallout}
      {view === 'topology' && (
        <>
          {topologyProgressCallout}
          {topologyErrorCallout}
          <EuiSpacer size="m" />
          <TopologyMapAccordion
            knowledgeIndicators={filteredKnowledgeIndicators}
            isLoading={isLoading || isGeneratingTopology}
            selectedNodeId={selectedKnowledgeIndicatorId}
            onNodeClick={handleTopologyNodeClick}
          />
        </>
      )}
      <EuiSpacer size="m" />
      <KnowledgeIndicatorsToolbar
        knowledgeIndicators={knowledgeIndicators}
        view={view}
        filteredCount={filteredKnowledgeIndicators.length}
        tableSearchValue={tableSearchValue}
        debouncedSearchTerm={debouncedSearchTerm}
        statusFilter={statusFilter}
        selectedTypes={selectedTypes}
        selectedSubtypes={selectedSubtypes}
        selectedStreams={selectedStreams}
        hideComputedTypes={hideComputedTypes}
        pagination={pagination}
        selectedKnowledgeIndicators={selectedKnowledgeIndicators}
        isBulkOperationInProgress={isBulkOperationInProgress}
        isBulkPromoteInProgress={isBulkPromoteInProgress}
        isDeleting={isDeleting}
        isSelectionActionsDisabled={isSelectionActionsDisabled}
        selectionContainsNonExcludable={selectionContainsNonExcludable}
        hasPromotableSelected={hasPromotableSelected}
        blocksActivity={blocksActivity}
        activityBlockTooltip={activityBlockTooltip}
        onSearchChange={handleSearchChange}
        onStatusFilterChange={handleStatusFilterChange}
        onSelectedTypesChange={handleSelectedTypesChange}
        onSelectedSubtypesChange={handleSelectedSubtypesChange}
        onSelectedStreamsChange={handleSelectedStreamsChange}
        onComputedToggleChange={handleComputedToggleChange}
        onClearSelection={() => setSelectedKnowledgeIndicators([])}
        onBulkExclude={handleBulkExclude}
        onBulkRestore={handleBulkRestore}
        onBulkPromote={handleBulkPromote}
        onDeleteSelected={() => setKnowledgeIndicatorsToDelete(selectedKnowledgeIndicators)}
      />
      <EuiSpacer size="s" />
      <EuiHorizontalRule
        margin="none"
        css={css`
          height: ${euiTheme.border.width.thick};
        `}
      />
      {hasOnlyHiddenComputedFeatures && (
        <>
          <EuiSpacer size="s" />
          <EuiCallOut
            size="s"
            color="primary"
            title={HIDDEN_COMPUTED_FEATURES_HINT}
            announceOnMount={false}
          />
        </>
      )}
      <EuiPanel
        color="transparent"
        hasShadow={false}
        hasBorder={false}
        paddingSize="none"
        css={css`
          overflow-x: auto;
          min-width: 0;
          ${isOperationInProgress
            ? `
                pointer-events: none;
                opacity: 0.6;
              `
            : ''}
        `}
      >
        <EuiInMemoryTable<KnowledgeIndicator>
          css={css`
            min-width: 700px;

            & thead tr {
              background-color: ${euiTheme.colors.backgroundBaseSubdued};
            }
          `}
          items={filteredKnowledgeIndicators}
          itemId={getKnowledgeIndicatorItemId}
          columns={columns}
          loading={isOperationInProgress}
          rowProps={(ki: KnowledgeIndicator) => ({
            isSelected: selectedKnowledgeIndicatorId === getKnowledgeIndicatorItemId(ki),
          })}
          selection={{
            selected: selectedKnowledgeIndicators,
            onSelectionChange: setSelectedKnowledgeIndicators,
          }}
          pagination={{
            pageIndex: pagination.pageIndex,
            pageSize: pagination.pageSize,
            pageSizeOptions: [25, 50, 100],
          }}
          onTableChange={handleTableChange}
          tableCaption={TABLE_CAPTION}
          noItemsMessage={!isLoading ? NO_ITEMS_MESSAGE : ''}
        />
      </EuiPanel>
      {selectedKnowledgeIndicator ? (
        <KnowledgeIndicatorDetailsFlyout
          key={getKnowledgeIndicatorItemId(selectedKnowledgeIndicator)}
          knowledgeIndicator={selectedKnowledgeIndicator}
          occurrencesByQueryId={occurrencesByQueryId}
          onClose={closeFlyout}
          features={features}
          stream={streamsByName.get(getKnowledgeIndicatorStreamName(selectedKnowledgeIndicator))}
          pageIndex={currentIndex}
          pageCount={filteredKnowledgeIndicators.length}
          onSelectPage={(nextIndex) => {
            const ki = filteredKnowledgeIndicators[nextIndex];
            if (!ki) {
              return;
            }
            goToPageForItemIndex(nextIndex);
            selectKnowledgeIndicator(ki);
          }}
        />
      ) : null}
      {knowledgeIndicatorsToDelete.length > 0 ? (
        <DeleteTableItemsModal
          title={DELETE_MODAL_TITLE(knowledgeIndicatorsToDelete.length)}
          items={knowledgeIndicatorsToDelete}
          onCancel={() => setKnowledgeIndicatorsToDelete([])}
          onConfirm={() => {
            void deleteKnowledgeIndicatorsInBulk(knowledgeIndicatorsToDelete);
          }}
          isLoading={isDeleting}
        />
      ) : null}
    </EuiPanel>
  );
}
