/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { MAX_SVG_LENGTH } from '@kbn/agent-builder-visualizations-common';
import { validateSvgMarkup } from './validate_svg';

const DIAGRAM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect x="10" y="10" width="80" height="40" fill="#e6f0ff" stroke="#0061a6"/>
  <text x="20" y="35" font-size="12">API</text>
  <path d="M90 30 L120 30" stroke="#333" fill="none"/>
</svg>`;

const expectRejected = (markup: string, reasonPattern: RegExp) => {
  const result = validateSvgMarkup(markup);
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.reason).toMatch(reasonPattern);
  }
};

describe('validateSvgMarkup', () => {
  describe('accepts static drawings', () => {
    it('returns the sanitized document for a plain diagram', () => {
      const result = validateSvgMarkup(DIAGRAM);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.svg).toContain('<svg');
        expect(result.svg).toContain('<rect');
        expect(result.svg).toContain('API');
      }
    });

    it('is idempotent: the sanitized output validates again unchanged in meaning', () => {
      const first = validateSvgMarkup(DIAGRAM);
      expect(first.valid).toBe(true);
      if (first.valid) {
        const second = validateSvgMarkup(first.svg);
        expect(second.valid).toBe(true);
      }
    });

    it('allows a gradient referenced from the same document', () => {
      const result = validateSvgMarkup(
        `<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>`
      );

      expect(result.valid).toBe(true);
    });
  });

  describe('rejects content that can run code or load a resource', () => {
    it('rejects a document without an svg root element', () => {
      expectRejected('<div>not a drawing</div>', /<svg> root element/);
    });

    it('rejects a script element', () => {
      expectRejected('<svg><script>alert(1)</script></svg>', /<script>/);
    });

    it('rejects an event handler attribute', () => {
      expectRejected('<svg onload="alert(1)"><rect width="1" height="1"/></svg>', /on\*/);
    });

    it('rejects a foreignObject, which can host HTML', () => {
      expectRejected(
        '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject></svg>',
        /foreignObject/
      );
    });

    it('rejects a style element', () => {
      expectRejected(
        '<svg><style>rect{fill:red}</style><rect width="1" height="1"/></svg>',
        /<style>/
      );
    });

    it('rejects a use element', () => {
      expectRejected('<svg><use href="https://evil.example/x.svg#a"/></svg>', /links, external/);
    });

    it('rejects an href attribute on any element', () => {
      expectRejected(
        '<svg><rect width="1" height="1" href="https://evil.example"/></svg>',
        /href, src and data/
      );
    });

    it('rejects an xlink:href attribute', () => {
      expectRejected(
        '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><rect width="1" height="1" xlink:href="https://evil.example"/></svg>',
        /href, src and data/
      );
    });

    it('rejects a url() reference to anything other than an element in the same document', () => {
      expectRejected(
        '<svg><rect width="1" height="1" fill="url(https://evil.example/x.svg#a)"/></svg>',
        /url\(#id\)/
      );
    });

    it('rejects a DOCTYPE with an external entity', () => {
      expectRejected(
        '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
        /DOCTYPE and ENTITY/
      );
    });

    it('rejects script-scheme URLs', () => {
      expectRejected('<svg><text>javascript:alert(1)</text></svg>', /script-scheme/);
    });

    it('rejects animation elements, which can rewrite href at runtime', () => {
      expectRejected(
        '<svg><rect width="1" height="1"><set attributeName="href" to="javascript:alert(1)"/></rect></svg>',
        /links, external images, animation/
      );
    });
  });

  it('rejects a document longer than the maximum length', () => {
    const oversized = `<svg>${'a'.repeat(MAX_SVG_LENGTH)}</svg>`;

    expectRejected(oversized, /at most/);
  });
});
