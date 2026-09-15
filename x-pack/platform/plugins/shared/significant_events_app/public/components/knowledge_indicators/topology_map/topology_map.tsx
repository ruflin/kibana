/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { EuiCallOut, useEuiTheme } from '@elastic/eui';
import { css } from '@emotion/react';
import type {
  TopologyGraph,
  TopologyNode as TopologyNodeModel,
} from '@kbn/significant-events-schema';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type ColorMode,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';
import React, { Component, useCallback, useMemo, type ReactNode } from 'react';
import '@xyflow/react/dist/style.css';
import { applyDagreLayout } from './apply_dagre_layout';
import { TopologyNode, type TopologyFlowNode } from './topology_node';
import { TOPOLOGY_MAP_ERROR_TITLE } from './translations';

const NODE_TYPES: NodeTypes = {
  topology: TopologyNode,
};

const DEFAULT_HEIGHT = 360;

export interface TopologyMapProps {
  graph: TopologyGraph;
  onNodeClick?: (node: TopologyNodeModel) => void;
  interactive?: boolean;
  height?: number;
  selectedNodeId?: string;
}

interface GraphErrorBoundaryState {
  error: Error | null;
}

class GraphErrorBoundary extends Component<
  { children: ReactNode; errorTitle: string },
  GraphErrorBoundaryState
> {
  state: GraphErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): GraphErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <EuiCallOut
          announceOnMount
          title={this.props.errorTitle}
          color="danger"
          iconType="error"
          data-test-subj="significantEventsTopologyMapError"
        >
          <p>{this.state.error.message}</p>
        </EuiCallOut>
      );
    }
    return this.props.children;
  }
}

function toTopologyNode(data: TopologyFlowNode['data']): TopologyNodeModel {
  return {
    id: data.id,
    featureId: data.featureId,
    type: data.type,
    ...(data.subtype ? { subtype: data.subtype } : {}),
    label: data.label,
    streamName: data.streamName,
  };
}

function toFlowNodes(graph: TopologyGraph, selectedNodeId?: string): TopologyFlowNode[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: 'topology',
    position: { x: 0, y: 0 },
    selected: selectedNodeId === node.id,
    data: { ...node },
  }));
}

function toFlowEdges(graph: TopologyGraph): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
    style: {
      strokeWidth: edge.kind === 'computed' ? 1 : 1.5,
      strokeDasharray: edge.kind === 'computed' ? '4 4' : undefined,
      opacity: edge.kind === 'computed' ? 0.55 : 1,
    },
  }));
}

function TopologyMapCanvas({
  graph,
  onNodeClick,
  interactive = true,
  height = DEFAULT_HEIGHT,
  selectedNodeId,
}: TopologyMapProps) {
  const { euiTheme, colorMode } = useEuiTheme();

  const { nodes, edges } = useMemo(() => {
    const rawNodes = toFlowNodes(graph, selectedNodeId);
    const rawEdges = toFlowEdges(graph);
    return {
      nodes: applyDagreLayout(rawNodes, rawEdges),
      edges: rawEdges,
    };
  }, [graph, selectedNodeId]);

  const handleNodeClick = useCallback<NodeMouseHandler<TopologyFlowNode>>(
    (_event, node) => {
      if (!interactive) {
        return;
      }
      onNodeClick?.(toTopologyNode(node.data));
    },
    [interactive, onNodeClick]
  );

  return (
    <div
      data-test-subj="significantEventsTopologyMapCanvas"
      css={css`
        width: 100%;
        height: ${height}px;
      `}
    >
      <ReactFlow<TopologyFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={interactive}
        panOnDrag={interactive}
        zoomOnScroll={interactive}
        zoomOnPinch={interactive}
        proOptions={{ hideAttribution: true }}
        colorMode={colorMode.toLowerCase() as ColorMode}
        onNodeClick={handleNodeClick}
      >
        <Background gap={24} size={1} color={euiTheme.colors.borderBaseSubdued} />
        {interactive ? <Controls showInteractive={false} /> : null}
      </ReactFlow>
    </div>
  );
}

export function TopologyMap(props: TopologyMapProps) {
  return (
    <GraphErrorBoundary errorTitle={TOPOLOGY_MAP_ERROR_TITLE}>
      <ReactFlowProvider>
        <TopologyMapCanvas {...props} />
      </ReactFlowProvider>
    </GraphErrorBoundary>
  );
}
