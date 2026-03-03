/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  EuiBadge,
  EuiButton,
  EuiButtonIcon,
  EuiFlexGroup,
  EuiFlexItem,
  EuiHealth,
  EuiInMemoryTable,
  EuiLink,
  EuiText,
  type EuiBasicTableColumn,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { Feature } from '@kbn/streams-schema';
import { OnboardingStep } from '@kbn/streams-schema';
import { upperFirst } from 'lodash';
import pMap from 'p-map';
import React, { useState, useCallback } from 'react';
import { useFetchFeatures } from '../../../../hooks/use_fetch_features';
import { useAIFeatures } from '../../../../hooks/use_ai_features';
import { useKibana } from '../../../../hooks/use_kibana';
import { getLast24HoursTimeRange } from '../../../../util/time_range';
import { getFormattedError } from '../../../../util/errors';
import { LoadingPanel } from '../../../loading_panel';
import { FeatureDetailsFlyout } from '../../../stream_detail_systems/stream_features/feature_details_flyout';
import { getConfidenceColor } from '../../../stream_detail_systems/stream_features/use_stream_features_table';

export function FeaturesTable() {
  const { data, isLoading: loading, refetch } = useFetchFeatures();
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const aiFeatures = useAIFeatures();
  const {
    core: {
      notifications: { toasts },
    },
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();

  const handleSelectFeature = useCallback((feature: Feature | null) => {
    setSelectedFeature(feature);
  }, []);

  const handleCloseFlyout = useCallback(() => {
    setSelectedFeature(null);
  }, []);

  const handleRegenerateFeatures = useCallback(async () => {
    const features = data?.features ?? [];
    const uniqueStreamNames = [...new Set(features.map((f) => f.stream_name).filter(Boolean))];

    if (uniqueStreamNames.length === 0) {
      toasts.addInfo({
        title: i18n.translate(
          'xpack.streams.significantEventsDiscovery.featuresTable.noStreamsToRegenerate',
          { defaultMessage: 'No streams with features to regenerate' }
        ),
      });
      return;
    }

    const connectorId = aiFeatures?.genAiConnectors.selectedConnector;
    if (!connectorId) return;

    setIsRegenerating(true);
    const { from, to } = getLast24HoursTimeRange();

    try {
      await pMap(
        uniqueStreamNames,
        async (streamName) => {
          await streamsRepositoryClient.fetch(
            'POST /internal/streams/{streamName}/onboarding/_task',
            {
              params: {
                path: { streamName },
                query: { saveQueries: true },
                body: {
                  action: 'schedule' as const,
                  from,
                  to,
                  connectorId,
                  steps: [OnboardingStep.FeaturesIdentification],
                },
              },
            }
          );
        },
        { concurrency: 5 }
      );
      toasts.addSuccess({
        title: i18n.translate(
          'xpack.streams.significantEventsDiscovery.featuresTable.regenerateSuccess',
          {
            defaultMessage: 'Feature identification started for {count} streams',
            values: { count: uniqueStreamNames.length },
          }
        ),
      });
      setTimeout(() => refetch(), 10000);
    } catch (error) {
      toasts.addError(getFormattedError(error as Error), {
        title: i18n.translate(
          'xpack.streams.significantEventsDiscovery.featuresTable.regenerateError',
          { defaultMessage: 'Failed to regenerate features' }
        ),
      });
    } finally {
      setIsRegenerating(false);
    }
  }, [data?.features, aiFeatures, toasts, refetch, streamsRepositoryClient]);

  if (loading && !data) {
    return <LoadingPanel size="l" />;
  }

  const columns: Array<EuiBasicTableColumn<Feature>> = [
    {
      field: 'details',
      name: '',
      width: '40px',
      render: (_: unknown, feature: Feature) => (
        <EuiButtonIcon
          data-test-subj="featuresDiscoveryDetailsButton"
          iconType="expand"
          aria-label={i18n.translate(
            'xpack.streams.significantEventsDiscovery.featuresTable.detailsButtonAriaLabel',
            { defaultMessage: 'View details' }
          )}
          onClick={() => handleSelectFeature(feature)}
        />
      ),
    },
    {
      field: 'name',
      name: i18n.translate('xpack.streams.significantEventsDiscovery.featuresTable.featureColumn', {
        defaultMessage: 'Feature',
      }),
      truncateText: true,
      render: (_name: string, feature: Feature) => {
        const displayTitle = feature.title ?? feature.id;
        const secondaryText = feature.subtype ?? feature.type ?? '';
        return (
          <EuiLink
            onClick={() => handleSelectFeature(feature)}
            data-test-subj="featuresDiscoveryFeatureNameLink"
          >
            <EuiFlexGroup direction="column" gutterSize="none">
              <EuiFlexItem grow={false}>
                <EuiText size="s">{displayTitle}</EuiText>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiText size="xs" color="subdued">
                  {secondaryText}
                </EuiText>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiLink>
        );
      },
    },
    {
      field: 'type',
      name: i18n.translate('xpack.streams.significantEventsDiscovery.featuresTable.typeColumn', {
        defaultMessage: 'Type',
      }),
      width: '15%',
      render: (type: string) => <EuiBadge color="hollow">{upperFirst(type ?? '–')}</EuiBadge>,
    },
    {
      field: 'confidence',
      name: i18n.translate(
        'xpack.streams.significantEventsDiscovery.featuresTable.confidenceColumn',
        {
          defaultMessage: 'Confidence',
        }
      ),
      width: '12%',
      render: (confidence: number) => (
        <EuiHealth color={getConfidenceColor(confidence ?? 0)}>{confidence ?? '–'}</EuiHealth>
      ),
    },
    {
      field: 'stream_name',
      name: i18n.translate('xpack.streams.significantEventsDiscovery.featuresTable.streamColumn', {
        defaultMessage: 'Stream',
      }),
      width: '15%',
      render: (_streamName: string, feature: Feature) => (
        <EuiBadge color="hollow">{feature.stream_name || '--'}</EuiBadge>
      ),
    },
  ];

  return (
    <EuiFlexGroup direction="column" gutterSize="m">
      <EuiFlexItem grow={false}>
        <EuiFlexGroup alignItems="center" gutterSize="s">
          <EuiFlexItem grow={false}>
            <EuiText size="s">
              {i18n.translate(
                'xpack.streams.significantEventsDiscovery.featuresTable.featuresCount',
                {
                  defaultMessage: '{count} Features',
                  values: { count: data?.features.length ?? 0 },
                }
              )}
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButton
              iconType="refresh"
              size="s"
              isLoading={isRegenerating}
              disabled={
                isRegenerating ||
                !aiFeatures?.genAiConnectors?.selectedConnector ||
                (data?.features.length ?? 0) === 0
              }
              onClick={handleRegenerateFeatures}
            >
              {i18n.translate(
                'xpack.streams.significantEventsDiscovery.featuresTable.regenerateButton',
                { defaultMessage: 'Regenerate features' }
              )}
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <EuiInMemoryTable
          tableCaption={i18n.translate(
            'xpack.streams.significantEventsDiscovery.featuresTable.tableCaption',
            { defaultMessage: 'Features table' }
          )}
          columns={columns}
          itemId="id"
          items={data?.features ?? []}
          loading={loading}
          search={{
            box: {
              incremental: true,
              placeholder: i18n.translate(
                'xpack.streams.significantEventsDiscovery.featuresTable.searchPlaceholder',
                { defaultMessage: 'Search features' }
              ),
            },
            filters: [],
          }}
          searchFormat="text"
          noItemsMessage={
            !loading
              ? i18n.translate(
                  'xpack.streams.significantEventsDiscovery.featuresTable.noItemsMessage',
                  {
                    defaultMessage: 'No features found',
                  }
                )
              : ''
          }
        />
      </EuiFlexItem>
      {selectedFeature && (
        <FeatureDetailsFlyout feature={selectedFeature} onClose={handleCloseFlyout} />
      )}
    </EuiFlexGroup>
  );
}
