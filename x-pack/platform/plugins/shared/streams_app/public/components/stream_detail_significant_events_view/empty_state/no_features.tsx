/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import {
  EuiButtonEmpty,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import React from 'react';
import { AssetImage } from '../../asset_image';
import { useAIFeatures } from '../add_significant_event_flyout/generated_flow_form/use_ai_features';
import { GenerateSuggestionButton } from '../../data_management/stream_detail_routing/review_suggestions_form/generate_suggestions_button';

export function NoFeaturesEmptyState({
  onFeatureIdentificationClick,
  onManualEntryClick,
}: {
  onFeatureIdentificationClick: (connectorId: string) => void;
  onManualEntryClick: () => void;
}) {
  const aiFeatures = useAIFeatures();

  if (!aiFeatures) {
    return null;
  }

  return (
    <EuiFlexGroup direction="column" alignItems="center" justifyContent="center">
      <EuiSpacer size="m" />
      <AssetImage type="checklist" size="m" />
      <EuiTitle size="s">
        <h2>
          {i18n.translate('xpack.streams.significantEvents.noFeatures.title', {
            defaultMessage: 'Stream features missing',
          })}
        </h2>
      </EuiTitle>
      <EuiText size="s" textAlign="center" css={{ maxWidth: 480 }}>
        {i18n.translate('xpack.streams.significantEvents.noFeatures.description', {
          defaultMessage:
            'Feature identification generates logical subsets of the data in that stream. This is useful for generating better significant events.',
        })}
      </EuiText>
      <EuiFlexGroup direction="row" gutterSize="s" alignItems="center">
        <EuiFlexItem grow={false}>
          <GenerateSuggestionButton
            aiFeatures={aiFeatures}
            onClick={onFeatureIdentificationClick}
            data-test-subj="significant_events_identify_features_button"
          >
            {i18n.translate(
              'xpack.streams.significantEvents.noFeatures.featureIdentificationButtonLabel',
              {
                defaultMessage: 'Identify features',
              }
            )}
          </GenerateSuggestionButton>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonEmpty
            onClick={onManualEntryClick}
            data-test-subj="significant_events_manual_entry_no_features_button"
          >
            {i18n.translate('xpack.streams.significantEvents.noFeatures.manualEntryButtonLabel', {
              defaultMessage: 'Manual entry',
            })}
          </EuiButtonEmpty>
        </EuiFlexItem>
      </EuiFlexGroup>
    </EuiFlexGroup>
  );
}
