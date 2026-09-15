/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiAccordion, EuiFlexGroup, EuiFlexItem, EuiPanel, EuiText } from '@elastic/eui';
import type { KnowledgeIndicator } from '@kbn/nightshift-ai';
import React, { useMemo } from 'react';
import { getKnowledgeIndicatorType } from '../../../../components/knowledge_indicators/utils/get_knowledge_indicator_type';
import {
  TOPOLOGY_MAP_DEPENDENCY_COUNT,
  TOPOLOGY_MAP_EMPTY,
  TOPOLOGY_MAP_ENTITY_COUNT,
  TOPOLOGY_MAP_INFRASTRUCTURE_COUNT,
  TOPOLOGY_MAP_PLACEHOLDER,
  TOPOLOGY_MAP_TECHNOLOGY_COUNT,
  TOPOLOGY_MAP_TITLE,
} from './translations';

export function TopologyMapStub({
  knowledgeIndicators,
}: {
  knowledgeIndicators: KnowledgeIndicator[];
}) {
  const counts = useMemo(() => {
    const next = { entity: 0, technology: 0, infrastructure: 0, dependency: 0 };
    for (const ki of knowledgeIndicators) {
      const type = getKnowledgeIndicatorType(ki);
      if (type in next) {
        next[type as keyof typeof next] += 1;
      }
    }
    return next;
  }, [knowledgeIndicators]);

  const total = counts.entity + counts.technology + counts.infrastructure + counts.dependency;

  return (
    <EuiAccordion
      id="significantEventsTopologyMap"
      initialIsOpen
      buttonContent={TOPOLOGY_MAP_TITLE}
      data-test-subj="significantEventsTopologyMapStub"
    >
      <EuiPanel hasBorder hasShadow={false} paddingSize="m">
        {total === 0 ? (
          <EuiText color="subdued" size="s">
            <p>{TOPOLOGY_MAP_EMPTY}</p>
          </EuiText>
        ) : (
          <EuiFlexGroup direction="column" gutterSize="s">
            <EuiFlexItem>
              <EuiFlexGroup gutterSize="l" wrap>
                <EuiFlexItem grow={false}>
                  <EuiText size="s">{TOPOLOGY_MAP_ENTITY_COUNT(counts.entity)}</EuiText>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiText size="s">{TOPOLOGY_MAP_TECHNOLOGY_COUNT(counts.technology)}</EuiText>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiText size="s">
                    {TOPOLOGY_MAP_INFRASTRUCTURE_COUNT(counts.infrastructure)}
                  </EuiText>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiText size="s">{TOPOLOGY_MAP_DEPENDENCY_COUNT(counts.dependency)}</EuiText>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiText color="subdued" size="s">
                <p>{TOPOLOGY_MAP_PLACEHOLDER}</p>
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        )}
      </EuiPanel>
    </EuiAccordion>
  );
}
