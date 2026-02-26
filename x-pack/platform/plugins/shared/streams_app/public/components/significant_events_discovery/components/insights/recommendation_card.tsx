/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import {
  EuiAccordion,
  EuiBadge,
  EuiFlexGroup,
  EuiFlexItem,
  EuiPanel,
  EuiSpacer,
  EuiSteps,
  EuiText,
  EuiTitle,
  useGeneratedHtmlId,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import useToggle from 'react-use/lib/useToggle';
import type { Recommendation, SeverityLevel } from '@kbn/streams-schema';

const priorityColors: Record<SeverityLevel, 'danger' | 'warning' | 'primary' | 'hollow'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'primary',
  low: 'hollow',
};

const priorityLabels: Record<SeverityLevel, string> = {
  critical: i18n.translate('xpack.streams.recommendations.priority.critical', {
    defaultMessage: 'Critical',
  }),
  high: i18n.translate('xpack.streams.recommendations.priority.high', {
    defaultMessage: 'High',
  }),
  medium: i18n.translate('xpack.streams.recommendations.priority.medium', {
    defaultMessage: 'Medium',
  }),
  low: i18n.translate('xpack.streams.recommendations.priority.low', {
    defaultMessage: 'Low',
  }),
};

interface RecommendationCardProps {
  recommendation: Recommendation;
  index: number;
}

export function RecommendationCard({ recommendation, index }: RecommendationCardProps) {
  const [isOpen, toggleIsOpen] = useToggle(index === 0);
  const accordionId = useGeneratedHtmlId({ prefix: 'recommendationAccordion' });

  return (
    <EuiPanel hasBorder paddingSize="m">
      <EuiAccordion
        id={accordionId}
        data-test-subj="streamsRecommendationCardAccordion"
        forceState={isOpen ? 'open' : 'closed'}
        onToggle={toggleIsOpen}
        buttonContent={
          <EuiFlexGroup alignItems="center" gutterSize="m" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiBadge color={priorityColors[recommendation.priority]}>
                {priorityLabels[recommendation.priority]}
              </EuiBadge>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiTitle size="xs">
                <h3>{recommendation.title}</h3>
              </EuiTitle>
            </EuiFlexItem>
          </EuiFlexGroup>
        }
        paddingSize="m"
      >
        <EuiSpacer size="s" />

        <EuiText size="s">
          <p>{recommendation.description}</p>
        </EuiText>

        {recommendation.steps.length > 0 && (
          <>
            <EuiSpacer size="m" />
            <EuiSteps
              titleSize="xs"
              steps={recommendation.steps.map((step, idx) => ({
                title: i18n.translate('xpack.streams.recommendations.stepTitle', {
                  defaultMessage: 'Step {number}',
                  values: { number: idx + 1 },
                }),
                children: (
                  <EuiText size="s">
                    <p>{step}</p>
                  </EuiText>
                ),
              }))}
            />
          </>
        )}

        {recommendation.insightRefs.length > 0 && (
          <>
            <EuiSpacer size="m" />
            <EuiText size="xs">
              <strong>
                {i18n.translate('xpack.streams.recommendations.addressesInsights', {
                  defaultMessage: 'Addresses insights:',
                })}
              </strong>{' '}
              {recommendation.insightRefs.map((ref) => `#${ref + 1}`).join(', ')}
            </EuiText>
          </>
        )}
      </EuiAccordion>
    </EuiPanel>
  );
}
