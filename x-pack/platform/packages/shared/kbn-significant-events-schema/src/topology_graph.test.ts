/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { computeFeatureUuid } from './feature';
import type { Feature } from './feature';
import { featuresToTopologyGraph } from './topology_graph';

function makeFeature(overrides: Partial<Feature> & Pick<Feature, 'id' | 'type'>): Feature {
  const base = {
    stream_name: 'logs.claims',
    description: `${overrides.type} ${overrides.id}`,
    properties: {},
    confidence: 100,
    ...overrides,
  };
  return {
    ...base,
    uuid: overrides.uuid ?? computeFeatureUuid(base),
  };
}

describe('featuresToTopologyGraph', () => {
  it('builds nodes from non-excluded entity, technology, and infrastructure features', () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      subtype: 'service',
      title: 'frontend',
      properties: { name: 'frontend', runtime: 'java' },
    });
    const java = makeFeature({
      id: 'technology-java',
      type: 'technology',
      title: 'Java',
      properties: { name: 'java' },
    });
    const postgres = makeFeature({
      id: 'infra-postgres',
      type: 'infrastructure',
      subtype: 'database',
      title: 'postgres',
      properties: { name: 'postgres', technology: 'postgres' },
    });
    const schema = makeFeature({
      id: 'schema-logs',
      type: 'schema',
      title: 'logs schema',
      properties: {},
    });
    const computed = makeFeature({
      id: 'dataset-analysis-1',
      type: 'dataset_analysis',
      title: 'Field analysis',
      properties: {},
    });

    const graph = featuresToTopologyGraph([frontend, java, postgres, schema, computed]);

    expect(graph.nodes.map((node) => node.featureId).sort()).toEqual([
      'entity-frontend',
      'infra-postgres',
      'technology-java',
    ]);
    expect(graph.nodes.find((node) => node.featureId === 'entity-frontend')).toEqual({
      id: frontend.uuid,
      featureId: 'entity-frontend',
      type: 'entity',
      subtype: 'service',
      label: 'frontend',
      streamName: 'logs.claims',
    });
    expect(graph.edges).toEqual([]);
    expect(graph.unresolvedEndpoints).toEqual([]);
  });

  it('omits excluded features from nodes and edges', () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      title: 'frontend',
      properties: { name: 'frontend' },
    });
    const excludedTarget = makeFeature({
      id: 'entity-backend',
      type: 'entity',
      title: 'backend',
      properties: { name: 'backend' },
      excluded: true,
    });
    const dependency = makeFeature({
      id: 'dep-frontend-backend',
      type: 'dependency',
      title: 'frontend → backend',
      properties: { source: 'frontend', target: 'backend', protocol: 'http' },
    });

    const graph = featuresToTopologyGraph([frontend, excludedTarget, dependency]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].featureId).toBe('entity-frontend');
    expect(graph.edges).toEqual([]);
    expect(graph.unresolvedEndpoints).toEqual([
      { ref: 'backend', role: 'target', dependencyId: dependency.uuid },
    ]);
  });

  it('creates dependency edges and resolves endpoints by id, uuid, name, then title', () => {
    const byId = makeFeature({
      id: 'checkout',
      type: 'entity',
      title: 'Checkout Service',
      properties: { name: 'checkout-svc' },
    });
    const byUuid = makeFeature({
      id: 'entity-payments',
      type: 'entity',
      title: 'Payments',
      properties: { name: 'payments' },
    });
    const byName = makeFeature({
      id: 'entity-balancereader',
      type: 'entity',
      title: 'Balance Reader',
      properties: { name: 'BalanceReader' },
    });
    const byTitle = makeFeature({
      id: 'entity-ledger',
      type: 'entity',
      title: 'Ledger Writer',
      properties: {},
    });
    const edges = [
      makeFeature({
        id: 'dep-by-id',
        type: 'dependency',
        properties: { source: 'checkout', target: byUuid.uuid, protocol: 'grpc' },
      }),
      makeFeature({
        id: 'dep-by-name',
        type: 'dependency',
        properties: { source: 'balancereader', target: 'ledger writer' },
      }),
    ];

    const graph = featuresToTopologyGraph([byId, byUuid, byName, byTitle, ...edges]);

    expect(graph.unresolvedEndpoints).toEqual([]);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        source: byId.uuid,
        target: byUuid.uuid,
        kind: 'dependency',
        label: 'grpc',
        dependencyId: edges[0].uuid,
      }),
      expect.objectContaining({
        source: byName.uuid,
        target: byTitle.uuid,
        kind: 'dependency',
        dependencyId: edges[1].uuid,
      }),
    ]);
  });

  it('accepts from/to property names used by canonical KI fixtures', () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      title: 'frontend',
      properties: { name: 'frontend' },
    });
    const backend = makeFeature({
      id: 'entity-backend',
      type: 'entity',
      title: 'backend',
      properties: { name: 'backend' },
    });
    const dependency = makeFeature({
      id: 'dep-frontend-backend',
      type: 'dependency',
      title: 'frontend → backend',
      properties: { from: 'frontend', to: 'backend' },
    });

    const graph = featuresToTopologyGraph([frontend, backend, dependency]);

    expect(graph.edges).toEqual([
      expect.objectContaining({
        source: frontend.uuid,
        target: backend.uuid,
        kind: 'dependency',
        label: 'frontend → backend',
      }),
    ]);
  });

  it('lists unresolved endpoints without inventing nodes', () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      title: 'frontend',
      properties: { name: 'frontend' },
    });
    const dependency = makeFeature({
      id: 'dep-frontend-unknown',
      type: 'dependency',
      title: 'frontend → missing-svc',
      properties: { source: 'frontend', target: 'missing-svc', protocol: 'http' },
    });

    const graph = featuresToTopologyGraph([frontend, dependency]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes.map((node) => node.label)).toEqual(['frontend']);
    expect(graph.edges).toEqual([]);
    expect(graph.unresolvedEndpoints).toEqual([
      { ref: 'missing-svc', role: 'target', dependencyId: dependency.uuid },
    ]);
  });

  it('adds quieter computed edges from entity technology and infraDeps when those nodes exist', () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      subtype: 'service',
      title: 'frontend',
      properties: { name: 'frontend', runtime: 'java', infraDeps: ['postgres', 'redis'] },
    });
    const postgresEntity = makeFeature({
      id: 'entity-postgres',
      type: 'entity',
      subtype: 'database',
      title: 'postgres',
      properties: { name: 'postgres', technology: 'postgres' },
    });
    const java = makeFeature({
      id: 'technology-java',
      type: 'technology',
      title: 'Java',
      properties: { name: 'java' },
    });
    const redis = makeFeature({
      id: 'infra-redis',
      type: 'infrastructure',
      title: 'redis',
      properties: { name: 'redis' },
    });
    const frontendWithTech = makeFeature({
      ...frontend,
      properties: { ...frontend.properties, technology: 'java' },
    });

    const graph = featuresToTopologyGraph([frontendWithTech, postgresEntity, java, redis]);

    const computedEdges = graph.edges.filter((edge) => edge.kind === 'computed');
    expect(computedEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: frontendWithTech.uuid,
          target: java.uuid,
          kind: 'computed',
        }),
        expect.objectContaining({
          source: frontendWithTech.uuid,
          target: postgresEntity.uuid,
          kind: 'computed',
        }),
        expect.objectContaining({
          source: frontendWithTech.uuid,
          target: redis.uuid,
          kind: 'computed',
        }),
      ])
    );
    expect(computedEdges).toHaveLength(3);
  });

  it('does not invent nodes for unresolved computed technology or infraDeps refs', () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      title: 'frontend',
      properties: { name: 'frontend', technology: 'cobol', infraDeps: ['mystery-db'] },
    });

    const graph = featuresToTopologyGraph([frontend]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toEqual([]);
    expect(graph.unresolvedEndpoints).toEqual([]);
  });

  it('prefers a dependency edge over a duplicate computed edge', () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      title: 'frontend',
      properties: { name: 'frontend', infraDeps: ['postgres'] },
    });
    const postgres = makeFeature({
      id: 'entity-postgres',
      type: 'entity',
      title: 'postgres',
      properties: { name: 'postgres' },
    });
    const dependency = makeFeature({
      id: 'dep-frontend-postgres',
      type: 'dependency',
      title: 'frontend → postgres',
      properties: { source: 'frontend', target: 'postgres', protocol: 'sql' },
    });

    const graph = featuresToTopologyGraph([frontend, postgres, dependency]);

    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toEqual(
      expect.objectContaining({
        kind: 'dependency',
        label: 'sql',
        source: frontend.uuid,
        target: postgres.uuid,
      })
    );
  });

  it('skips self-loop edges', () => {
    const postgres = makeFeature({
      id: 'entity-postgres',
      type: 'entity',
      title: 'postgres',
      properties: { name: 'postgres', technology: 'postgres' },
    });

    const graph = featuresToTopologyGraph([postgres]);

    expect(graph.edges).toEqual([]);
  });

  it('skips excluded dependency features', () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      title: 'frontend',
      properties: { name: 'frontend' },
    });
    const backend = makeFeature({
      id: 'entity-backend',
      type: 'entity',
      title: 'backend',
      properties: { name: 'backend' },
    });
    const dependency = makeFeature({
      id: 'dep-frontend-backend',
      type: 'dependency',
      title: 'frontend → backend',
      properties: { source: 'frontend', target: 'backend' },
      excluded: true,
    });

    const graph = featuresToTopologyGraph([frontend, backend, dependency]);

    expect(graph.edges).toEqual([]);
    expect(graph.unresolvedEndpoints).toEqual([]);
  });
});
