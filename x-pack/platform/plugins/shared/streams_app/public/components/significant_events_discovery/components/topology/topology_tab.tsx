/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  EuiButton,
  EuiButtonIcon,
  EuiCodeBlock,
  EuiEmptyPrompt,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiLoadingSpinner,
  EuiModal,
  EuiModalBody,
  EuiModalHeader,
  EuiModalHeaderTitle,
  EuiPanel,
  EuiText,
  EuiToolTip,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { useAIFeatures } from '../../../../hooks/use_ai_features';
import { useKibana } from '../../../../hooks/use_kibana';

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

function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'rendering' | 'done' | 'error'>('rendering');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [svgHtml, setSvgHtml] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!code || !containerRef.current) {
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
        const id = `topology-diagram-${renderCounter}`;
        const el = containerRef.current!;
        el.innerHTML = '';

        const { svg } = await mermaid.render(id, code, el);
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
  }, [code]);

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
              {errorMsg ? `Render error: ${errorMsg}` : 'Topology diagram (source)'}
            </EuiText>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiCodeBlock language="text" isCopyable paddingSize="s" fontSize="s">
          {code}
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
                <EuiFlexItem>
                  {i18n.translate('xpack.streams.topology.fullscreenTitle', {
                    defaultMessage: 'Topology Diagram',
                  })}
                </EuiFlexItem>
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
}

export function TopologyTab() {
  const aiFeatures = useAIFeatures();
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
    core: { notifications },
  } = useKibana();

  const [mermaidCode, setMermaidCode] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setMermaidCode(null);
    try {
      const result = await streamsRepositoryClient.fetch('POST /internal/streams/_topology', {
        params: {
          body: {
            connectorId: aiFeatures?.genAiConnectors.selectedConnector,
          },
        },
      });
      setMermaidCode(result.mermaid);
      setHasGenerated(true);
    } catch (e) {
      notifications.toasts.addError(e instanceof Error ? e : new Error(String(e)), {
        title: i18n.translate('xpack.streams.topology.errorTitle', {
          defaultMessage: 'Error generating topology diagram',
        }),
      });
    } finally {
      setIsGenerating(false);
    }
  }, [streamsRepositoryClient, aiFeatures?.genAiConnectors.selectedConnector, notifications.toasts]);

  useEffect(() => {
    if (!hasGenerated) {
      handleGenerate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isGenerating) {
    return (
      <EuiEmptyPrompt
        icon={<EuiLoadingSpinner size="xl" />}
        title={
          <h3>
            {i18n.translate('xpack.streams.topology.generatingTitle', {
              defaultMessage: 'Generating topology diagram...',
            })}
          </h3>
        }
        body={
          <p>
            {i18n.translate('xpack.streams.topology.generatingDescription', {
              defaultMessage:
                'Analyzing stream features and generating a visual topology using AI. This may take a moment.',
            })}
          </p>
        }
      />
    );
  }

  if (!mermaidCode) {
    return (
      <EuiEmptyPrompt
        icon={<EuiIcon type="visVega" size="xl" />}
        title={
          <h3>
            {i18n.translate('xpack.streams.topology.noTopologyTitle', {
              defaultMessage: 'No topology diagram',
            })}
          </h3>
        }
        body={
          <p>
            {i18n.translate('xpack.streams.topology.noTopologyDescription', {
              defaultMessage:
                'Click "Generate topology" to create a visual diagram of your stream topology from extracted features.',
            })}
          </p>
        }
        actions={
          <EuiButton fill iconType="sparkles" onClick={handleGenerate}>
            {i18n.translate('xpack.streams.topology.generateButton', {
              defaultMessage: 'Generate topology',
            })}
          </EuiButton>
        }
      />
    );
  }

  return (
    <EuiFlexGroup direction="column" gutterSize="l">
      <EuiFlexItem grow={false}>
        <EuiFlexGroup alignItems="center" gutterSize="m">
          <EuiFlexItem grow={false}>
            <EuiButton iconType="refresh" onClick={handleGenerate}>
              {i18n.translate('xpack.streams.topology.regenerateButton', {
                defaultMessage: 'Regenerate',
              })}
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>
      <EuiFlexItem>
        <MermaidDiagram code={mermaidCode} />
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}
