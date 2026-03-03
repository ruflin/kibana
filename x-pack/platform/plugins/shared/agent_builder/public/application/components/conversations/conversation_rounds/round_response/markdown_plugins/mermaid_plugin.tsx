/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { Parent } from 'mdast';
import type { Node } from 'unist';
import {
  EuiButtonIcon,
  EuiCodeBlock,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiModal,
  EuiModalBody,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiPanel,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';

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

let mermaidApi: typeof import('mermaid').default | null = null;
let mermaidLoadFailed = false;
let renderCounter = 0;

const getMermaid = async (): Promise<typeof import('mermaid').default | null> => {
  if (mermaidApi) return mermaidApi;
  if (mermaidLoadFailed) return null;

  try {
    const mod = await import('mermaid');
    mermaidApi = mod.default;
    mermaidApi.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'Inter, system-ui, sans-serif',
    });
    return mermaidApi;
  } catch {
    mermaidLoadFailed = true;
    return null;
  }
};

export const MermaidRenderer: React.FC<{ value?: string }> = ({ value }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'rendering' | 'done' | 'error'>('rendering');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!value || !containerRef.current) {
      setPhase('error');
      return;
    }

    let cancelled = false;

    const renderDiagram = async () => {
      const mermaid = await getMermaid();
      if (!mermaid || cancelled) {
        if (!cancelled) setPhase('error');
        return;
      }

      try {
        renderCounter += 1;
        const id = `mermaid-diagram-${renderCounter}`;

        const el = containerRef.current!;
        el.innerHTML = '';

        const { svg } = await mermaid.render(id, value, el);
        if (!cancelled) {
          el.innerHTML = svg;
          setSvgHtml(svg);
          setPhase('done');
        }
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : String(e));
          setPhase('error');
        }
      }
    };

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [value]);

  const openFullscreen = useCallback(() => setIsFullscreen(true), []);
  const closeFullscreen = useCallback(() => setIsFullscreen(false), []);

  if (phase === 'error') {
    return (
      <EuiPanel color="subdued" paddingSize="m">
        <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiIcon type="visVega" />
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiText size="xs" color="subdued">
              {errorMsg ? `Mermaid render error: ${errorMsg}` : 'Mermaid Diagram (source)'}
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiCodeBlock language="text" isCopyable paddingSize="s" fontSize="s">
          {value ?? ''}
        </EuiCodeBlock>
      </EuiPanel>
    );
  }

  return (
    <>
      <EuiPanel
        color={phase === 'done' ? 'plain' : 'subdued'}
        paddingSize="m"
        hasBorder={phase === 'done'}
      >
        {phase === 'done' && (
          <EuiFlexGroup justifyContent="flexEnd" gutterSize="none" css={{ marginBottom: 4 }}>
            <EuiFlexItem grow={false}>
              <EuiToolTip content="View fullscreen">
                <EuiButtonIcon
                  iconType="fullScreen"
                  aria-label="View diagram fullscreen"
                  size="xs"
                  color="text"
                  onClick={openFullscreen}
                />
              </EuiToolTip>
            </EuiFlexItem>
          </EuiFlexGroup>
        )}
        <div
          ref={containerRef}
          css={{
            overflow: 'auto',
            minHeight: phase === 'rendering' ? 40 : undefined,
            '& svg': {
              width: '100%',
              height: 'auto',
            },
          }}
        />
      </EuiPanel>

      {isFullscreen && svgHtml && (
        <EuiModal
          onClose={closeFullscreen}
          css={{
            width: '90vw',
            maxWidth: '90vw',
            height: '85vh',
            maxHeight: '85vh',
          }}
        >
          <EuiModalHeader>
            <EuiModalHeaderTitle>
              <EuiFlexGroup alignItems="center" gutterSize="s">
                <EuiFlexItem grow={false}>
                  <EuiIcon type="visVega" />
                </EuiFlexItem>
                <EuiFlexItem>Diagram</EuiFlexItem>
              </EuiFlexGroup>
            </EuiModalHeaderTitle>
          </EuiModalHeader>
          <EuiModalBody>
            <div
              dangerouslySetInnerHTML={{ __html: svgHtml }}
              css={{
                width: '100%',
                height: '100%',
                overflow: 'auto',
                '& svg': {
                  width: '100%',
                  height: 'auto',
                  minHeight: '60vh',
                },
              }}
            />
          </EuiModalBody>
        </EuiModal>
      )}
    </>
  );
};
