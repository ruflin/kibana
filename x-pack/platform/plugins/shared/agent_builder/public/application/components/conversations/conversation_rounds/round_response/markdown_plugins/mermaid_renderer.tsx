/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

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
        suppressErrorRendering: true,
        theme: 'neutral',
        securityLevel: 'loose',
        fontFamily: 'Inter, system-ui, sans-serif',
      });
      return mermaidInstance;
    });
  }
  return mermaidLoadPromise;
};

const containerStyle: React.CSSProperties = {
  border: '1px solid #d3dae6',
  borderRadius: '6px',
  padding: '16px',
  background: '#fafbfd',
  overflowX: 'auto',
  marginBottom: '16px',
};

const errorStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  background: '#fef0ef',
  color: '#bd271e',
  fontSize: '13px',
  marginBottom: '8px',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginBottom: '4px',
};

const buttonStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #d3dae6',
  borderRadius: '4px',
  padding: '2px 8px',
  cursor: 'pointer',
  color: '#69707d',
  fontSize: '12px',
};

const codeStyle: React.CSSProperties = {
  background: '#f5f7fa',
  border: '1px solid #d3dae6',
  borderRadius: '6px',
  padding: '12px',
  fontFamily: 'monospace',
  fontSize: '13px',
  whiteSpace: 'pre-wrap',
  overflowX: 'auto',
  marginBottom: '16px',
};

export const MermaidRenderer: React.FC<MermaidRendererProps> = ({ value }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const [showSource, setShowSource] = useState(false);

  const renderDiagram = useCallback(
    async (container: HTMLDivElement) => {
      try {
        setError(null);
        setRendered(false);
        const mermaid = await loadMermaid();

        const diagramId = `mermaid-diagram-${++idCounter}`;
        const trimmedValue = value.trim();

        const { svg } = await mermaid.render(diagramId, trimmedValue, container);

        container.replaceChildren();
        const parser = new DOMParser();
        const doc = parser.parseFromString(svg, 'image/svg+xml');
        container.replaceChildren(doc.documentElement);

        setRendered(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [value]
  );

  useEffect(() => {
    if (containerRef.current && !showSource) {
      renderDiagram(containerRef.current);
    }
  }, [renderDiagram, showSource]);

  if (error) {
    return (
      <div>
        <div style={errorStyle}>Failed to render Mermaid diagram</div>
        <div style={codeStyle}>{value}</div>
      </div>
    );
  }

  if (showSource) {
    return (
      <div>
        <div style={toolbarStyle}>
          <button type="button" style={buttonStyle} onClick={() => setShowSource(false)}>
            Diagram
          </button>
        </div>
        <div style={codeStyle}>{value}</div>
      </div>
    );
  }

  return (
    <div>
      <div style={toolbarStyle}>
        {rendered && (
          <button type="button" style={buttonStyle} onClick={() => setShowSource(true)}>
            Source
          </button>
        )}
      </div>
      <div ref={containerRef} style={containerStyle} />
    </div>
  );
};
