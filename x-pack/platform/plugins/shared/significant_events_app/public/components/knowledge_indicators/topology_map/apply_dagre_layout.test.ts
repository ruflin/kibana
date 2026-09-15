/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Edge, Node } from '@xyflow/react';
import { applyDagreLayout } from './apply_dagre_layout';

const node = (id: string): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {},
});

describe('applyDagreLayout', () => {
  it('returns an empty list unchanged', () => {
    expect(applyDagreLayout([], [])).toEqual([]);
  });

  it('places connected nodes at distinct coordinates', () => {
    const nodes = [node('a'), node('b')];
    const edges: Edge[] = [{ id: 'a-b', source: 'a', target: 'b' }];

    const layouted = applyDagreLayout(nodes, edges);

    expect(layouted).toHaveLength(2);
    expect(layouted[0].position).not.toEqual(layouted[1].position);
    expect(layouted.every((item) => Number.isFinite(item.position.x))).toBe(true);
    expect(layouted.every((item) => Number.isFinite(item.position.y))).toBe(true);
  });
});
