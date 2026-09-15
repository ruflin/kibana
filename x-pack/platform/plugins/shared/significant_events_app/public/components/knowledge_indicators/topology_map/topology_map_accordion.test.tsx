/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { I18nProvider } from '@kbn/i18n-react';
import type { KnowledgeIndicator } from '@kbn/nightshift-ai';
import { computeFeatureUuid, type Feature } from '@kbn/significant-events-schema';
import { TopologyMapAccordion } from './topology_map_accordion';

jest.mock('./topology_map', () => ({
  TopologyMap: () => <div data-test-subj="significantEventsTopologyMapCanvas" />,
}));

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

function makeFeatureKI(overrides: Partial<Feature> & Pick<Feature, 'id' | 'type'>): KnowledgeIndicator {
  return { kind: 'feature', feature: makeFeature(overrides) };
}

function renderAccordion(props: Partial<React.ComponentProps<typeof TopologyMapAccordion>> = {}) {
  return render(
    <I18nProvider>
      <TopologyMapAccordion knowledgeIndicators={[]} {...props} />
    </I18nProvider>
  );
}

describe('TopologyMapAccordion', () => {
  it('shows the empty state when there are no topology knowledge indicators', () => {
    renderAccordion();

    expect(screen.getByTestId('significantEventsTopologyMap')).toBeInTheDocument();
    expect(screen.getByTestId('significantEventsTopologyMapEmpty')).toHaveTextContent(
      /No topology knowledge indicators yet/
    );
    expect(screen.queryByTestId('significantEventsTopologyMapCanvas')).not.toBeInTheDocument();
  });

  it('shows type counts and the canvas when nodes exist', () => {
    renderAccordion({
      knowledgeIndicators: [
        makeFeatureKI({
          id: 'entity-frontend',
          type: 'entity',
          title: 'frontend',
          properties: { name: 'frontend' },
        }),
        makeFeatureKI({
          id: 'technology-java',
          type: 'technology',
          title: 'Java',
          properties: { name: 'java' },
        }),
        makeFeatureKI({
          id: 'infra-postgres',
          type: 'infrastructure',
          title: 'postgres',
          properties: { name: 'postgres' },
        }),
        makeFeatureKI({
          id: 'dep-frontend-postgres',
          type: 'dependency',
          title: 'frontend → postgres',
          properties: { source: 'frontend', target: 'postgres' },
        }),
      ],
    });

    expect(screen.getByText('1 entity')).toBeInTheDocument();
    expect(screen.getByText('1 technology')).toBeInTheDocument();
    expect(screen.getByText('1 infrastructure')).toBeInTheDocument();
    expect(screen.getByText('1 dependency')).toBeInTheDocument();
    expect(screen.getByTestId('significantEventsTopologyMapCanvas')).toBeInTheDocument();
    expect(screen.queryByTestId('significantEventsTopologyMapUnresolved')).not.toBeInTheDocument();
  });

  it('lists unresolved dependency endpoints without inventing nodes', () => {
    renderAccordion({
      knowledgeIndicators: [
        makeFeatureKI({
          id: 'entity-frontend',
          type: 'entity',
          title: 'frontend',
          properties: { name: 'frontend' },
        }),
        makeFeatureKI({
          id: 'dep-frontend-unknown',
          type: 'dependency',
          title: 'frontend → missing-svc',
          properties: { source: 'frontend', target: 'missing-svc' },
        }),
      ],
    });

    expect(screen.getByTestId('significantEventsTopologyMapUnresolved')).toHaveTextContent(
      'missing-svc'
    );
    expect(screen.getByTestId('significantEventsTopologyMapCanvas')).toBeInTheDocument();
  });

  it('shows a loading state', () => {
    renderAccordion({ isLoading: true });

    expect(screen.getByText('Loading topology map')).toBeInTheDocument();
    expect(screen.queryByTestId('significantEventsTopologyMapEmpty')).not.toBeInTheDocument();
  });
});
