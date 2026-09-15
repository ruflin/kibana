/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiFlexGroup, EuiFlexItem, EuiText } from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { SignificantEventsWorkflowStatus } from '@kbn/significant-events-schema';
import React, { useCallback, useMemo, useState } from 'react';
import { parseSearchQuery } from './utils';
import type { SignificantEventsSearchBarProps } from '../../../../components/search_bar';
import { SignificantEventsSearchBar } from '../../../../components/search_bar';
import { useAIFeatures } from '../../../../hooks/use_ai_features';
import { useBlocksNewActivity } from '../../../../hooks/use_significant_events_maintenance';
import { useNightshiftStreamEnabled } from '../../hooks/use_nightshift_stream_enabled';
import { useKiGeneration } from '../knowledge_indicators_table/ki_generation_context';
import { AddDataSourceButton } from './add_data_source_button';
import { STREAMS_TABLE_SEARCH_ARIA_LABEL } from './translations';
import { StreamsTreeTable } from './tree_table';

export function StreamsView() {
  const { blocksActivity, activityBlockTooltip } = useBlocksNewActivity();
  const [searchText, setSearchText] = useState('');

  const searchQuery = useMemo(() => parseSearchQuery(searchText), [searchText]);

  const {
    filteredStreams,
    isStreamsLoading,
    streamStatusMap,
    cancelOnboarding,
    bulkOnboardAll,
  } = useKiGeneration();

  const knownStreamNames = useMemo(
    () => filteredStreams?.map((item) => item.stream.name) ?? [],
    [filteredStreams]
  );

  const { isStreamEnabled, isStreamTogglePending, setStreamEnabled } = useNightshiftStreamEnabled({
    knownStreamNames,
    streamStatusMap,
    scheduleOnboarding: bulkOnboardAll,
    cancelOnboarding,
  });

  const aiFeatures = useAIFeatures();
  const allConnectors = aiFeatures?.genAiConnectors?.connectors ?? [];
  const connectorError = aiFeatures?.genAiConnectors?.error;
  const isConnectorCatalogUnavailable =
    !allConnectors.length || !!aiFeatures?.genAiConnectors?.loading || !!connectorError;

  const isStreamToggleDisabled = useCallback(
    (streamName: string, enabled: boolean) => {
      if (isStreamTogglePending(streamName)) {
        return true;
      }
      if (streamStatusMap[streamName]?.status === SignificantEventsWorkflowStatus.BeingCanceled) {
        return true;
      }
      if (enabled) {
        return false;
      }
      return blocksActivity || isConnectorCatalogUnavailable;
    },
    [blocksActivity, isConnectorCatalogUnavailable, isStreamTogglePending, streamStatusMap]
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
              placeholder={STREAMS_TABLE_SEARCH_ARIA_LABEL}
              query={{
                query: searchText,
                language: 'text',
              }}
              showDatePicker
              showQueryInput
              enableDateRangePicker
              submitButtonStyle="iconOnly"
              isClearable
            />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <AddDataSourceButton />
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>

      <EuiFlexItem grow={false}>
        <EuiText size="s">
          {i18n.translate('xpack.significantEventsApp.streamsTree.streamsCountLabel', {
            defaultMessage: '{count} streams',
            values: { count: filteredStreams?.length ?? 0 },
          })}
        </EuiText>
      </EuiFlexItem>

      <EuiFlexItem>
        <StreamsTreeTable
          streams={filteredStreams}
          streamOnboardingResultMap={streamStatusMap}
          loading={isStreamsLoading}
          searchQuery={searchQuery}
          activityBlockTooltip={activityBlockTooltip}
          isStreamEnabled={isStreamEnabled}
          isStreamToggleDisabled={isStreamToggleDisabled}
          onStreamEnabledChange={setStreamEnabled}
        />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}
