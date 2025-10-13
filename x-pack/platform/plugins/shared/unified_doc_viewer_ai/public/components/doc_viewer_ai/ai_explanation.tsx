/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import {
  EuiPanel,
  EuiTitle,
  EuiText,
  EuiSpacer,
  EuiFlexGroup,
  EuiFlexItem,
  EuiBadge,
  EuiCallOut,
} from '@elastic/eui';
import type { DocumentExplanation } from '../../../common/types';

export interface AiExplanationProps {
  analysis: DocumentExplanation;
  title?: string;
}

const URGENCY_COLORS = {
  low: 'default',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
} as const;

const URGENCY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
} as const;

export function AiExplanation({ analysis, title }: AiExplanationProps) {
  return (
    <>
      {title && (
        <>
          <EuiTitle size="xs">
            <h4>{title}</h4>
          </EuiTitle>
          <EuiSpacer size="s" />
        </>
      )}
      <EuiPanel paddingSize="m" hasShadow={false} hasBorder>
      <EuiFlexGroup direction="column" gutterSize="m">
        <EuiFlexItem>
          <EuiFlexGroup alignItems="center" gutterSize="s">
            <EuiFlexItem grow={false}>
              <EuiTitle size="s">
                <h3>{analysis.title}</h3>
              </EuiTitle>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiBadge color={URGENCY_COLORS[analysis.urgency]}>
                {URGENCY_LABELS[analysis.urgency]} Urgency
              </EuiBadge>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>

        <EuiFlexItem>
          <EuiText size="s">
            <strong>Summary</strong>
          </EuiText>
          <EuiSpacer size="xs" />
          <EuiText size="s">
            <p>{analysis.summary}</p>
          </EuiText>
        </EuiFlexItem>

        <EuiFlexItem>
          <EuiText size="s">
            <strong>Description</strong>
          </EuiText>
          <EuiSpacer size="xs" />
          <EuiText size="s">
            <p style={{ whiteSpace: 'pre-wrap' }}>{analysis.description}</p>
          </EuiText>
        </EuiFlexItem>

        {analysis.proposedFix && (analysis.urgency === 'high' || analysis.urgency === 'critical') && (
          <EuiFlexItem>
            <EuiCallOut
              title="Proposed Fix"
              color={analysis.urgency === 'critical' ? 'danger' : 'warning'}
              iconType="wrench"
            >
              <p>{analysis.proposedFix}</p>
            </EuiCallOut>
          </EuiFlexItem>
        )}

        {analysis.resources && Object.keys(analysis.resources).length > 0 && (
          <EuiFlexItem>
            <EuiText size="s">
              <strong>Resources / Systems</strong>
            </EuiText>
            <EuiSpacer size="xs" />
            <EuiFlexGroup wrap gutterSize="s">
              {Object.entries(analysis.resources).map(([key, value]) => (
                <EuiFlexItem grow={false} key={key}>
                  <EuiBadge color="hollow">
                    <strong>{key}:</strong> {value}
                  </EuiBadge>
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>
    </EuiPanel>
    </>
  );
}

