/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  computeFeatureUuid,
  isDuplicateFeature,
  MAX_ID_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  normalizeFeatureSlug,
  TOPOLOGY_NODE_TYPES,
  type Feature,
  type FeatureUpsert,
  type TopologyNodeType,
} from '@kbn/significant-events-schema';

export const TOPOLOGY_FEATURE_TYPES = [...TOPOLOGY_NODE_TYPES, 'dependency'] as const;
export type TopologyFeatureType = (typeof TOPOLOGY_FEATURE_TYPES)[number];

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

const clip = (value: string, max: number): string =>
  value.length <= max ? value : value.slice(0, max);

const featureSlug = (type: TopologyFeatureType, name: string): string =>
  clip(normalizeFeatureSlug(`${type}-${name}`), MAX_ID_LENGTH);

const readDependencyEndpoints = (
  properties: Feature['properties']
): { source?: string; target?: string } => ({
  source: asNonEmptyString(properties.source) ?? asNonEmptyString(properties.from),
  target: asNonEmptyString(properties.target) ?? asNonEmptyString(properties.to),
});

const toWorkingFeature = (feature: FeatureUpsert): Feature => ({
  ...feature,
  uuid: computeFeatureUuid(feature),
});

const findNode = (features: readonly Feature[], ref: string): Feature | undefined => {
  const key = normalizeKey(ref);
  const nodes = features.filter(
    (feature) => !feature.excluded && isTopologyNodeType(feature.type)
  );

  return (
    nodes.find((feature) => feature.id === ref) ??
    nodes.find((feature) => feature.uuid === ref) ??
    nodes.find((feature) => {
      const name = asNonEmptyString(feature.properties.name);
      return name !== undefined && normalizeKey(name) === key;
    }) ??
    nodes.find((feature) => {
      const title = asNonEmptyString(feature.title);
      return title !== undefined && normalizeKey(title) === key;
    })
  );
};

const dependencyPairExists = (
  features: readonly Feature[],
  source: Feature,
  target: Feature
): boolean =>
  features.some((feature) => {
    if (feature.excluded || feature.type !== 'dependency') {
      return false;
    }
    const { source: sourceRef, target: targetRef } = readDependencyEndpoints(feature.properties);
    if (!sourceRef || !targetRef) {
      return false;
    }
    const sourceNode = findNode(features, sourceRef);
    const targetNode = findNode(features, targetRef);
    return sourceNode?.uuid === source.uuid && targetNode?.uuid === target.uuid;
  });

const isAlreadyPresent = (
  features: readonly Feature[],
  incoming: FeatureUpsert
): boolean =>
  features.some(
    (feature) =>
      !feature.excluded &&
      (isDuplicateFeature(feature, incoming) ||
        (feature.stream_name === incoming.stream_name &&
          normalizeFeatureSlug(feature.id) === normalizeFeatureSlug(incoming.id)))
  );

const impliedDescription = (source: Feature, kind: string, name: string): string =>
  clip(
    `${kind} implied by ${source.type} knowledge indicator ${source.id} (${name})`,
    MAX_TEXT_LENGTH
  );

/**
 * Materializes topology knowledge indicators that existing features already imply:
 * technology / infrastructure nodes referenced by entities, node stubs for unresolved
 * dependency endpoints, and dependency KIs for implied entity→technology/infrastructure
 * relationships. Does not invent topology that existing knowledge indicators do not support.
 */
export const deriveImpliedTopologyFeatures = (features: readonly Feature[]): FeatureUpsert[] => {
  const working: Feature[] = features.filter((feature) => !feature.excluded);
  const created: FeatureUpsert[] = [];

  const addFeature = (incoming: FeatureUpsert): Feature | undefined => {
    if (isAlreadyPresent(working, incoming)) {
      return findNode(working, incoming.id) ?? toWorkingFeature(incoming);
    }
    created.push(incoming);
    const next = toWorkingFeature(incoming);
    working.push(next);
    return next;
  };

  const ensureNode = ({
    ref,
    type,
    source,
    subtype,
  }: {
    ref: string;
    type: TopologyNodeType;
    source: Feature;
    subtype: string;
  }): Feature | undefined => {
    const existing = findNode(working, ref);
    if (existing) {
      return existing;
    }

    return addFeature({
      id: featureSlug(type, ref),
      stream_name: source.stream_name,
      type,
      subtype,
      title: clip(ref, MAX_TITLE_LENGTH),
      description: impliedDescription(source, type, ref),
      properties: { name: ref },
      confidence: source.confidence,
      evidence: [clip(`Implied by ${source.type} ${source.id}`, MAX_TEXT_LENGTH)],
      tags: ['topology', 'implied'],
    });
  };

  const entities = working.filter((feature) => feature.type === 'entity');

  for (const entity of entities) {
    for (const ref of asStringList(entity.properties.technology)) {
      ensureNode({ ref, type: 'technology', source: entity, subtype: 'runtime' });
    }
    for (const ref of asStringList(entity.properties.infraDeps)) {
      ensureNode({
        ref,
        type: 'infrastructure',
        source: entity,
        subtype: 'datastore',
      });
    }
  }

  const dependencies = working.filter((feature) => feature.type === 'dependency');
  for (const dependency of dependencies) {
    const { source: sourceRef, target: targetRef } = readDependencyEndpoints(dependency.properties);
    if (sourceRef && !findNode(working, sourceRef)) {
      ensureNode({
        ref: sourceRef,
        type: 'entity',
        source: dependency,
        subtype: 'service',
      });
    }
    if (targetRef && !findNode(working, targetRef)) {
      ensureNode({
        ref: targetRef,
        type: 'entity',
        source: dependency,
        subtype: 'service',
      });
    }
  }

  for (const entity of entities) {
    const impliedTargets = [
      ...asStringList(entity.properties.technology),
      ...asStringList(entity.properties.infraDeps),
    ];
    for (const ref of impliedTargets) {
      const target = findNode(working, ref);
      if (!target || dependencyPairExists(working, entity, target)) {
        continue;
      }

      const sourceLabel = asNonEmptyString(entity.title) ?? entity.id;
      const targetLabel = asNonEmptyString(target.title) ?? target.id;
      addFeature({
        id: featureSlug('dependency', `${entity.id}-${target.id}`),
        stream_name: entity.stream_name,
        type: 'dependency',
        subtype: 'uses',
        title: clip(`${sourceLabel} → ${targetLabel}`, MAX_TITLE_LENGTH),
        description: impliedDescription(entity, 'dependency', `${sourceLabel} → ${targetLabel}`),
        properties: { source: entity.id, target: target.id },
        confidence: entity.confidence,
        evidence: [clip(`Implied by entity ${entity.id}`, MAX_TEXT_LENGTH)],
        tags: ['topology', 'implied'],
      });
    }
  }

  return created;
};
