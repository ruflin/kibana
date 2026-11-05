/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { sanitizeSvg } from '@kbn/fs';
import { MAX_SVG_LENGTH } from '@kbn/agent-builder-visualizations-common';

export type SvgValidationResult = { valid: true; svg: string } | { valid: false; reason: string };

interface DeniedPattern {
  pattern: RegExp;
  reason: string;
}

// Checked before sanitizing, so the model gets a specific reason rather than a silently
// stripped document. Anything that slips past these is still removed by the sanitizer.
const DENIED_PATTERNS: readonly DeniedPattern[] = [
  { pattern: /<!\s*(doctype|entity)/i, reason: 'DOCTYPE and ENTITY declarations are not allowed' },
  { pattern: /<\s*script[\s>/]/i, reason: '<script> is not allowed' },
  {
    pattern: /<\s*style[\s>/]/i,
    reason: '<style> is not allowed; use presentation attributes such as fill and stroke',
  },
  { pattern: /<\s*foreignobject[\s>/]/i, reason: '<foreignObject> is not allowed' },
  {
    pattern:
      /<\s*(use|image|a|animate|animatemotion|animatetransform|set|iframe|object|embed|link|meta|feimage)[\s>/]/i,
    reason: 'links, external images, animation and embedded content are not allowed',
  },
  {
    pattern: /\s(href|xlink:href|src|data)\s*=/i,
    reason:
      'href, src and data attributes are not allowed; the SVG must not reference external resources',
  },
  { pattern: /\son[a-z]+\s*=/i, reason: 'event handler attributes (on*) are not allowed' },
  { pattern: /javascript:/i, reason: 'script-scheme URLs are not allowed' },
  { pattern: /expression\s*\(/i, reason: 'CSS expressions are not allowed' },
  { pattern: /@import/i, reason: '@import is not allowed' },
];

const EXTERNAL_URL_REFERENCE = /url\(\s*(['"]?)([^'")\s]*)/gi;
const ROOT_SVG_ELEMENT = /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i;

const invalid = (reason: string): SvgValidationResult => ({ valid: false, reason });

const findUrlReferenceProblem = (markup: string): string | undefined => {
  for (const [, , target] of markup.matchAll(EXTERNAL_URL_REFERENCE)) {
    if (!target.startsWith('#')) {
      return 'url() may only reference an element in the same SVG (url(#id))';
    }
  }
  return undefined;
};

/**
 * Validates model-written SVG markup and returns the sanitized document to store. Rejects, with a
 * reason the model can act on, anything that could run code or load a resource.
 */
export const validateSvgMarkup = (markup: string): SvgValidationResult => {
  if (markup.length > MAX_SVG_LENGTH) {
    return invalid(`the SVG must be at most ${MAX_SVG_LENGTH} characters`);
  }
  for (const { pattern, reason } of DENIED_PATTERNS) {
    if (pattern.test(markup)) {
      return invalid(reason);
    }
  }
  const urlProblem = findUrlReferenceProblem(markup);
  if (urlProblem) {
    return invalid(urlProblem);
  }
  if (!ROOT_SVG_ELEMENT.test(markup)) {
    return invalid('the document must have an <svg> root element');
  }

  let sanitized: string;
  try {
    sanitized = sanitizeSvg(Buffer.from(markup, 'utf8')).toString('utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return invalid(`the SVG could not be sanitized: ${message}`);
  }
  if (!ROOT_SVG_ELEMENT.test(sanitized)) {
    return invalid('the sanitized document has no <svg> root element');
  }
  return { valid: true, svg: sanitized };
};
