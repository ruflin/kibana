/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  EuiAccordion,
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSpacer,
  EuiText,
} from '@elastic/eui';
import type { KnowledgeIndicator } from '@kbn/nightshift-ai';
import {
  featuresToTopologyGraph,
  type TopologyGraph,
  type TopologyNode,
} from '@kbn/significant-events-schema';
import React, { useMemo } from 'react';
import { getFeaturesFromKIs } from '../utils/get_features_from_kis';
import { getKnowledgeIndicatorType } from '../utils/get_knowledge_indicator_type';
import { TopologyMap } from './topology_map';
import {
  TOPOLOGY_MAP_DEPENDENCY_COUNT,
  TOPOLOGY_MAP_EMPTY,
  TOPOLOGY_MAP_ENTITY_COUNT,
  TOPOLOGY_MAP_INFRASTRUCTURE_COUNT,
  TOPOLOGY_MAP_LOADING,
  TOPOLOGY_MAP_TECHNOLOGY_COUNT,
  TOPOLOGY_MAP_TITLE,
  TOPOLOGY_MAP_UNRESOLVED_DESCRIPTION,
  TOPOLOGY_MAP_UNRESOLVED_TITLE,
} from './translations';

export interface TopologyMapAccordionProps {
  knowledgeIndicators: KnowledgeIndicator[];
  isLoading?: boolean;
  onNodeClick?: (node: TopologyNode) => void;
  selectedNodeId?: string;
  interactive?: boolean;
  height?: number;
}

const countTypes = (knowledgeIndicators: KnowledgeIndicator[]) => {
  const next = { entity: 0, technology: 0, infrastructure: 0, dependency: 0 };
  for (const ki of knowledgeIndicators) {
    const type = getKnowledgeIndicatorType(ki);
    if (type in next) {
      next[type as keyof typeof next] += 1;
    }
  }
  return next;
};

const uniqueUnresolvedRefs = (graph: TopologyGraph): string[] => {
  const refs = new Set<string>();
  for (const endpoint of graph.unresolvedEndpoints) {
    refs.add(endpoint.ref);
  }
  return [...refs];
};

export function TopologyMapAccordion({
  knowledgeIndicators,
  isLoading = false,
  onNodeClick,
  selectedNodeId,
  interactive,
  height,
}: TopologyMapAccordionProps) {
  const counts = useMemo(() => countTypes(knowledgeIndicators), [knowledgeIndicators]);
  const graph = useMemo(
    () => featuresToTopologyGraph(getFeaturesFromKIs(knowledgeIndicators)),
    [knowledgeIndicators]
  );
  const unresolvedRefs = useMemo(() => uniqueUnresolvedRefs(graph), [graph]);
  const total = counts.entity + counts.technology + counts.infrastructure + counts.dependency;

  return (
    <EuiAccordion
      id="significantEventsTopologyMap"
      initialIsOpen
      buttonContent={TOPOLOGY_MAP_TITLE}
      data-test-subj="significantEventsTopologyMap"
    >
      <EuiPanel hasBorder hasShadow={false} paddingSize="m">
        {isLoading ? (
          <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiLoadingSpinner size="m" />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiText color="subdued" size="s">
                <p>{TOPOLOGY_MAP_LOADING}</p>
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        ) : total === 0 ? (
          <EuiText color="subdued" size="s" data-test-subj="significantEventsTopologyMapEmpty">
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
            {unresolvedRefs.length > 0 ? (
              <EuiFlexItem>
                <EuiCallOut
                  announceOnMount
                  size="s"
                  color="warning"
                  title={TOPOLOGY_MAP_UNRESOLVED_TITLE(unresolvedRefs.length)}
                  data-test-subj="significantEventsTopologyMapUnresolved"
                >
                  <p>{TOPOLOGY_MAP_UNRESOLVED_DESCRIPTION(unresolvedRefs.join(', '))}</p>
                </EuiCallOut>
              </EuiFlexItem>
            ) : null}
            {graph.nodes.length > 0 ? (
              <EuiFlexItem>
                <EuiSpacer size="s" />
                <TopologyMap
                  graph={graph}
                  onNodeClick={onNodeClick}
                  selectedNodeId={selectedNodeId}
                  interactive={interactive}
                  height={height}
                />
              </EuiFlexItem>
            ) : null}
          </EuiFlexGroup>
        )}
      </EuiPanel>
    </EuiAccordion>
  );
}
