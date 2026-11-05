/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo } from 'react';
import { css } from '@emotion/react';
import { i18n } from '@kbn/i18n';

const svgAltText = i18n.translate('xpack.agentBuilder.visualization.svg.alt', {
  defaultMessage: 'SVG visualization',
});

const svgContainerStyles = css({
  display: 'flex',
  justifyContent: 'center',
  width: '100%',
});

const svgImageStyles = css({
  maxWidth: '100%',
  height: 'auto',
});

/**
 * Encodes a sanitized SVG document as an image data URL. The markup is never parsed into the page,
 * because an SVG loaded as an image cannot run scripts or load external resources.
 */
export const toSvgDataUrl = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export interface VisualizeSvgProps {
  /** The sanitized SVG document under `svg`. */
  visualization: Record<string, unknown>;
}

/**
 * Renders a static SVG attachment inline. The server sanitizes the document before it is stored;
 * this component renders it only as an `<img>`, which is the second boundary if that check is
 * ever bypassed.
 */
export const VisualizeSvg = ({ visualization }: VisualizeSvgProps) => {
  const svg = typeof visualization.svg === 'string' ? visualization.svg : undefined;
  const src = useMemo(() => (svg ? toSvgDataUrl(svg) : undefined), [svg]);

  if (!src) {
    return null;
  }

  return (
    <div data-test-subj="agentBuilderSvgVisualization" css={svgContainerStyles}>
      <img src={src} alt={svgAltText} css={svgImageStyles} />
    </div>
  );
};
