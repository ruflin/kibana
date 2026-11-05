/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { VisualizeSvg, toSvgDataUrl } from '.';

const DRAWING = '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#0061a6"/></svg>';

describe('VisualizeSvg', () => {
  it('renders the drawing as an image data URL', () => {
    render(<VisualizeSvg visualization={{ svg: DRAWING }} />);

    const image = screen.getByRole('img', { name: 'SVG visualization' });
    expect(image.getAttribute('src')).toBe(toSvgDataUrl(DRAWING));
  });

  it('never places the markup into the page as elements', () => {
    const { container } = render(
      <VisualizeSvg visualization={{ svg: '<svg><script>alert(1)</script></svg>' }} />
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.innerHTML).not.toContain('<script');
  });

  it('renders nothing when the payload has no svg string', () => {
    const { container } = render(<VisualizeSvg visualization={{}} />);

    expect(container.firstChild).toBeNull();
  });
});
