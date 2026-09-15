/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { computeFeatureUuid, type Feature } from '@kbn/significant-events-schema';
import { deriveImpliedTopologyFeatures } from './derive_implied_topology_features';

function makeFeature(overrides: Partial<Feature> & Pick<Feature, 'id' | 'type'>): Feature {
  const base = {
    stream_name: 'logs.claims',
    description: `${overrides.type} ${overrides.id}`,
    properties: {},
    confidence: 90,
    ...overrides,
  };
  return {
    ...base,
    uuid: overrides.uuid ?? computeFeatureUuid(base),
  };
}

describe('deriveImpliedTopologyFeatures', () => {
  it('creates technology and infrastructure nodes plus dependencies from entity properties', () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      title: 'frontend',
      properties: { name: 'frontend', technology: 'java', infraDeps: ['postgres'] },
    });

    const created = deriveImpliedTopologyFeatures([frontend]);

    expect(created.map((feature) => `${feature.type}:${feature.id}`).sort()).toEqual([
      'dependency:dependency-entity-frontend-infrastructure-postgres',
      'dependency:dependency-entity-frontend-technology-java',
      'infrastructure:infrastructure-postgres',
      'technology:technology-java',
    ]);
    expect(created.find((feature) => feature.id === 'technology-java')?.properties).toEqual({
      name: 'java',
    });
    expect(
      created.find((feature) => feature.id === 'dependency-entity-frontend-technology-java')
        ?.properties
    ).toEqual({
      source: 'entity-frontend',
      target: 'technology-java',
    });
  });

  it('does not duplicate nodes or dependencies that already exist', () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      title: 'frontend',
      properties: { name: 'frontend', technology: 'java' },
    });
    const java = makeFeature({
      id: 'technology-java',
      type: 'technology',
      title: 'Java',
      properties: { name: 'java' },
    });
    const dependency = makeFeature({
      id: 'dep-frontend-java',
      type: 'dependency',
      properties: { source: 'entity-frontend', target: 'technology-java' },
    });

    expect(deriveImpliedTopologyFeatures([frontend, java, dependency])).toEqual([]);
  });

  it('creates entity stubs for unresolved dependency endpoints', () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      title: 'frontend',
      properties: { name: 'frontend' },
    });
    const dependency = makeFeature({
      id: 'dep-frontend-payments',
      type: 'dependency',
      properties: { source: 'frontend', target: 'payments' },
    });

    const created = deriveImpliedTopologyFeatures([frontend, dependency]);

    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'entity-payments',
          type: 'entity',
          properties: { name: 'payments' },
        }),
      ])
    );
  });

  it('ignores excluded features', () => {
    const frontend = makeFeature({
      id: 'entity-frontend',
      type: 'entity',
      excluded: true,
      properties: { name: 'frontend', technology: 'java' },
    });

    expect(deriveImpliedTopologyFeatures([frontend])).toEqual([]);
  });
});
