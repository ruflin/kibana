/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import {
  EuiCodeBlock,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiToolTip,
  EuiButtonIcon,
  useEuiTheme,
} from '@elastic/eui';

interface MermaidRendererProps {
  value: string;
}

let mermaidInstance: typeof import('mermaid')['default'] | null = null;
let mermaidLoadPromise: Promise<typeof import('mermaid')['default']> | null = null;
let idCounter = 0;

const loadMermaid = async (): Promise<typeof import('mermaid')['default']> => {
  if (mermaidInstance) {
    return mermaidInstance;
  }
  if (!mermaidLoadPromise) {
    mermaidLoadPromise = import('mermaid').then((mod) => {
      mermaidInstance = mod.default;
      mermaidInstance.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: 'strict',
        fontFamily: 'Inter, system-ui, sans-serif',
      });
      return mermaidInstance;
    });
  }
  return mermaidLoadPromise;
};

export const MermaidRenderer: React.FC<MermaidRendererProps> = ({ value }) => {
  const { euiTheme } = useEuiTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      try {
        setLoading(true);
        setError(null);
        const mermaid = await loadMermaid();
        if (cancelled) return;

        const diagramId = `mermaid-diagram-${++idCounter}`;
        const { svg: renderedSvg } = await mermaid.render(diagramId, value);
        if (cancelled) return;

        if (containerRef.current) {
          const parser = new DOMParser();
          const doc = parser.parseFromString(renderedSvg, 'image/svg+xml');
          const svgElement = doc.documentElement;
          containerRef.current.replaceChildren(svgElement);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    render();
    return () => {
      cancelled = true;
    };
  }, [value]);

  const containerCss = css`
    border: 1px solid ${euiTheme.colors.borderBaseSubdued};
    border-radius: ${euiTheme.border.radius.medium};
    padding: ${euiTheme.size.m};
    background: ${euiTheme.colors.backgroundBaseSubdued};
    overflow-x: auto;

    svg {
      max-width: 100%;
      height: auto;
    }
  `;

  const toolbarCss = css`
    display: flex;
    justify-content: flex-end;
    gap: ${euiTheme.size.xs};
    margin-bottom: ${euiTheme.size.xs};
  `;

  if (loading) {
    return (
      <>
        <EuiPanel color="subdued" paddingSize="l">
          <EuiFlexGroup justifyContent="center" alignItems="center">
            <EuiFlexItem grow={false}>
              <EuiLoadingSpinner size="m" />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiText size="s" color="subdued">
                Rendering diagram...
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiPanel>
        <EuiSpacer size="m" />
      </>
    );
  }

  if (error) {
    return (
      <>
        <EuiPanel color="danger" paddingSize="s">
          <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiIcon type="warning" color="danger" />
            </EuiFlexItem>
            <EuiFlexItem>
              <EuiText size="xs" color="danger">
                Failed to render Mermaid diagram
              </EuiText>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiPanel>
        <EuiSpacer size="s" />
        <EuiCodeBlock language="text" paddingSize="s" fontSize="s">
          {value}
        </EuiCodeBlock>
        <EuiSpacer size="m" />
      </>
    );
  }

  return (
    <>
      <div className={toolbarCss}>
        <EuiToolTip content={showSource ? 'Show diagram' : 'Show source'}>
          <EuiButtonIcon
            iconType={showSource ? 'eye' : 'editorCodeBlock'}
            aria-label={showSource ? 'Show diagram' : 'Show source'}
            size="xs"
            color="text"
            onClick={() => setShowSource(!showSource)}
          />
        </EuiToolTip>
      </div>
      {showSource ? (
        <EuiCodeBlock language="text" isCopyable paddingSize="s" fontSize="s">
          {value}
        </EuiCodeBlock>
      ) : (
        <div ref={containerRef} className={containerCss} />
      )}
      <EuiSpacer size="m" />
    </>
  );
};
