/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Parent } from 'mdast';
import type { Node } from 'unist';
import { EuiCodeBlock, EuiFlexGroup, EuiFlexItem, EuiIcon, EuiPanel, EuiText } from '@elastic/eui';

type CodeNode = Node & {
  lang?: string;
  value?: string;
};

export const mermaidLanguagePlugin = () => {
  const visitor = (node: Node) => {
    if ('children' in node) {
      const nodeAsParent = node as Parent;
      nodeAsParent.children.forEach((child) => {
        visitor(child);
      });
    }

    if (node.type === 'code' && (node as CodeNode).lang === 'mermaid') {
      node.type = 'mermaid';
    }
  };

  return (tree: Node) => {
    visitor(tree);
  };
};

let mermaidModule: typeof import('mermaid') | null = null;
let mermaidLoadFailed = false;

const loadMermaid = async (): Promise<typeof import('mermaid') | null> => {
  if (mermaidModule) return mermaidModule;
  if (mermaidLoadFailed) return null;

  try {
    mermaidModule = await import('mermaid');
    mermaidModule.default.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'strict',
    });
    return mermaidModule;
  } catch {
    mermaidLoadFailed = true;
    return null;
  }
};

export const MermaidRenderer: React.FC<{ value?: string }> = ({ value }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!value) {
      setFallback(true);
      return;
    }

    let cancelled = false;

    const renderDiagram = async () => {
      const mod = await loadMermaid();
      if (!mod || cancelled) {
        if (!cancelled) setFallback(true);
        return;
      }

      try {
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const { svg } = await mod.default.render(id, value);
        if (!cancelled) {
          setSvgContent(svg);
        }
      } catch {
        if (!cancelled) setFallback(true);
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [value]);

  if (svgContent) {
    return (
      <EuiPanel color="plain" paddingSize="m" hasBorder>
        <div
          ref={containerRef}
          dangerouslySetInnerHTML={{ __html: svgContent }}
          style={{ overflow: 'auto' }}
        />
      </EuiPanel>
    );
  }

  return (
    <EuiPanel color="subdued" paddingSize="m">
      <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiIcon type="visVega" />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiText size="xs" color="subdued">
            {fallback ? 'Mermaid Diagram (source)' : 'Loading diagram...'}
          </EuiText>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiCodeBlock language="text" isCopyable paddingSize="s" fontSize="s">
        {value ?? ''}
      </EuiCodeBlock>
    </EuiPanel>
  );
};
