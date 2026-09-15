/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Feature } from './feature';

export const TOPOLOGY_NODE_TYPES = ['entity', 'technology', 'infrastructure'] as const;
export type TopologyNodeType = (typeof TOPOLOGY_NODE_TYPES)[number];

export const TOPOLOGY_EDGE_KINDS = ['dependency', 'computed'] as const;
export type TopologyEdgeKind = (typeof TOPOLOGY_EDGE_KINDS)[number];

export interface TopologyNode {
  readonly id: string;
  readonly featureId: string;
  readonly type: TopologyNodeType;
  readonly subtype?: string;
  readonly label: string;
  readonly streamName: string;
}

export interface TopologyEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: TopologyEdgeKind;
  readonly label?: string;
  readonly dependencyId?: string;
}

export interface TopologyUnresolvedEndpoint {
  readonly ref: string;
  readonly role: 'source' | 'target';
  readonly dependencyId: string;
}

export interface TopologyGraph {
  readonly nodes: TopologyNode[];
  readonly edges: TopologyEdge[];
  readonly unresolvedEndpoints: TopologyUnresolvedEndpoint[];
}

const TOPOLOGY_NODE_TYPE_SET = new Set<string>(TOPOLOGY_NODE_TYPES);

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asStringList = (value: unknown): string[] => {
  if (typeof value === 'string') {
    const item = asNonEmptyString(value);
    return item ? [item] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const items: string[] = [];
  for (const entry of value) {
    const item = asNonEmptyString(entry);
    if (item) {
      items.push(item);
    }
  }
  return items;
};

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const isTopologyNodeType = (type: string): type is TopologyNodeType =>
  TOPOLOGY_NODE_TYPE_SET.has(type);

const nodeLabel = (feature: Feature): string =>
  asNonEmptyString(feature.title) ??
  asNonEmptyString(feature.properties.name) ??
  feature.id;

const toTopologyNode = (feature: Feature & { type: TopologyNodeType }): TopologyNode => ({
  id: feature.uuid,
  featureId: feature.id,
  type: feature.type,
  ...(feature.subtype ? { subtype: feature.subtype } : {}),
  label: nodeLabel(feature),
  streamName: feature.stream_name,
});

interface NodeLookup {
  byId: Map<string, TopologyNode>;
  byUuid: Map<string, TopologyNode>;
  byName: Map<string, TopologyNode>;
  byTitle: Map<string, TopologyNode>;
}

const registerIfAbsent = (map: Map<string, TopologyNode>, key: string, node: TopologyNode): void => {
  if (!map.has(key)) {
    map.set(key, node);
  }
};

const buildLookup = (
  nodeFeatures: Array<Feature & { type: TopologyNodeType }>,
  nodesByUuid: Map<string, TopologyNode>
): NodeLookup => {
  const lookup: NodeLookup = {
    byId: new Map(),
    byUuid: new Map(),
    byName: new Map(),
    byTitle: new Map(),
  };

  for (const feature of nodeFeatures) {
    const node = nodesByUuid.get(feature.uuid);
    if (!node) {
      continue;
    }
    registerIfAbsent(lookup.byId, feature.id, node);
    registerIfAbsent(lookup.byUuid, feature.uuid, node);
    const name = asNonEmptyString(feature.properties.name);
    if (name) {
      registerIfAbsent(lookup.byName, normalizeKey(name), node);
    }
    const title = asNonEmptyString(feature.title);
    if (title) {
      registerIfAbsent(lookup.byTitle, normalizeKey(title), node);
    }
  }

  return lookup;
};

const resolveEndpoint = (ref: string, lookup: NodeLookup): TopologyNode | undefined =>
  lookup.byId.get(ref) ??
  lookup.byUuid.get(ref) ??
  lookup.byName.get(normalizeKey(ref)) ??
  lookup.byTitle.get(normalizeKey(ref));

const edgePairKey = (sourceId: string, targetId: string): string => `${sourceId}→${targetId}`;

const readDependencyEndpoints = (
  properties: Feature['properties']
): { source?: string; target?: string } => ({
  source: asNonEmptyString(properties.source) ?? asNonEmptyString(properties.from),
  target: asNonEmptyString(properties.target) ?? asNonEmptyString(properties.to),
});

/**
 * Projects stored topology knowledge indicators into a graph. Excluded features
 * and non-topology types are omitted. Unresolved dependency endpoints are listed
 * rather than invented as nodes.
 */
export function featuresToTopologyGraph(features: readonly Feature[]): TopologyGraph {
  const nodeFeatures = features.filter(
    (feature): feature is Feature & { type: TopologyNodeType } =>
      !feature.excluded && isTopologyNodeType(feature.type)
  );
  const nodes = nodeFeatures.map(toTopologyNode);
  const nodesByUuid = new Map(nodes.map((node) => [node.id, node]));
  const lookup = buildLookup(nodeFeatures, nodesByUuid);

  const edges: TopologyEdge[] = [];
  const unresolvedEndpoints: TopologyUnresolvedEndpoint[] = [];
  const seenPairs = new Set<string>();

  const addEdge = (edge: TopologyEdge): void => {
    if (edge.source === edge.target) {
      return;
    }
    const pair = edgePairKey(edge.source, edge.target);
    if (seenPairs.has(pair)) {
      return;
    }
    seenPairs.add(pair);
    edges.push(edge);
  };

  for (const feature of features) {
    if (feature.excluded || feature.type !== 'dependency') {
      continue;
    }

    const { source: sourceRef, target: targetRef } = readDependencyEndpoints(feature.properties);
    if (!sourceRef || !targetRef) {
      continue;
    }

    const sourceNode = resolveEndpoint(sourceRef, lookup);
    const targetNode = resolveEndpoint(targetRef, lookup);

    if (!sourceNode) {
      unresolvedEndpoints.push({
        ref: sourceRef,
        role: 'source',
        dependencyId: feature.uuid,
      });
    }
    if (!targetNode) {
      unresolvedEndpoints.push({
        ref: targetRef,
        role: 'target',
        dependencyId: feature.uuid,
      });
    }
    if (!sourceNode || !targetNode) {
      continue;
    }

    const protocol = asNonEmptyString(feature.properties.protocol);
    const title = asNonEmptyString(feature.title);
    addEdge({
      id: `dependency:${feature.uuid}`,
      source: sourceNode.id,
      target: targetNode.id,
      kind: 'dependency',
      ...(protocol ? { label: protocol } : title ? { label: title } : {}),
      dependencyId: feature.uuid,
    });
  }

  for (const feature of nodeFeatures) {
    if (feature.type !== 'entity') {
      continue;
    }
    const sourceNode = lookup.byUuid.get(feature.uuid);
    if (!sourceNode) {
      continue;
    }

    const computedRefs = [
      ...asStringList(feature.properties.technology),
      ...asStringList(feature.properties.infraDeps),
    ];

    for (const ref of computedRefs) {
      const targetNode = resolveEndpoint(ref, lookup);
      if (!targetNode) {
        continue;
      }
      addEdge({
        id: `computed:${sourceNode.id}:${targetNode.id}:${normalizeKey(ref)}`,
        source: sourceNode.id,
        target: targetNode.id,
        kind: 'computed',
      });
    }
  }

  return { nodes, edges, unresolvedEndpoints };
}
