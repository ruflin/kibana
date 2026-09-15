/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import Dagre from '@dagrejs/dagre';
import { Position, type Edge, type Node } from '@xyflow/react';

export const TOPOLOGY_NODE_WIDTH = 180;
export const TOPOLOGY_NODE_HEIGHT = 56;

const RANK_SEPARATION = 80;
const NODE_SEPARATION = 48;
const GRAPH_MARGIN = 24;

/**
 * Positions React Flow nodes with a left-to-right dagre layout.
 */
export function applyDagreLayout<T extends Node>(nodes: T[], edges: Edge[]): T[] {
  if (nodes.length === 0) {
    return nodes;
  }

  const graph = new Dagre.graphlib.Graph({ directed: true, compound: false })
    .setGraph({
      rankdir: 'LR',
      ranksep: RANK_SEPARATION,
      nodesep: NODE_SEPARATION,
      marginx: GRAPH_MARGIN,
      marginy: GRAPH_MARGIN,
    })
    .setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: TOPOLOGY_NODE_WIDTH,
      height: TOPOLOGY_NODE_HEIGHT,
    });
  });

  edges.forEach((edge) => {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  });

  try {
    Dagre.layout(graph);
  } catch {
    return applyGridFallbackLayout(nodes);
  }

  return nodes.map((node) => {
    const dagreNode = graph.node(node.id);
    if (!dagreNode) {
      return {
        ...node,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      };
    }

    return {
      ...node,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      position: {
        x: Math.round(dagreNode.x - TOPOLOGY_NODE_WIDTH / 2),
        y: Math.round(dagreNode.y - TOPOLOGY_NODE_HEIGHT / 2),
      },
    };
  });
}

function applyGridFallbackLayout<T extends Node>(nodes: T[]): T[] {
  const cols = Math.ceil(Math.sqrt(nodes.length));
  return nodes.map((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      ...node,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      position: {
        x: Math.round(GRAPH_MARGIN + col * (TOPOLOGY_NODE_WIDTH + NODE_SEPARATION)),
        y: Math.round(GRAPH_MARGIN + row * (TOPOLOGY_NODE_HEIGHT + RANK_SEPARATION)),
      },
    };
  });
}
