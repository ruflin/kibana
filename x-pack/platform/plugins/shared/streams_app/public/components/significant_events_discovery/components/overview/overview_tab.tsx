/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiButton,
  EuiCard,
  EuiCodeBlock,
  EuiEmptyPrompt,
  EuiMarkdownFormat,
  EuiFlexGroup,
  EuiFlexItem,
  EuiIcon,
  EuiLink,
  EuiLoadingSpinner,
  EuiPanel,
  EuiSpacer,
  EuiStat,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { Discovery, Recommendation, Suggestion } from '@kbn/streams-schema';
import { useFetchDiscoveryQueries } from '../../../../hooks/use_fetch_discovery_queries';
import { useFetchFeatures } from '../../../../hooks/use_fetch_features';
import { useKibana } from '../../../../hooks/use_kibana';
import { useStreamsAppFetch } from '../../../../hooks/use_streams_app_fetch';
import { useStreamsAppRouter } from '../../../../hooks/use_streams_app_router';
import { MermaidDiagram } from '../topology/topology_tab';

const severityColors: Record<string, 'danger' | 'warning' | 'primary' | 'hollow'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'primary',
  low: 'hollow',
};

const priorityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const typeIcons: Record<string, string> = {
  alert: 'bell',
  dashboard: 'dashboardApp',
  slo: 'visGauge',
  viz: 'visArea',
  investigation: 'folderCheck',
};

const typeLabels: Record<string, string> = {
  alert: 'Alert',
  dashboard: 'Dashboard',
  slo: 'SLO',
  viz: 'Visualization',
  investigation: 'Investigation',
};

interface RankedRecommendation extends Recommendation {
  discoveryTitle: string;
  discoverySeverity: string;
}

export function OverviewTab() {
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();
  const router = useStreamsAppRouter();

  const discoveriesFetch = useStreamsAppFetch(
    async ({ signal }) =>
      streamsRepositoryClient.fetch('GET /internal/streams/_discoveries', {
        params: { query: {} },
        signal,
      }),
    [streamsRepositoryClient]
  );

  const suggestionsFetch = useStreamsAppFetch(
    async ({ signal }) =>
      streamsRepositoryClient.fetch('GET /internal/streams/_suggestions', {
        params: { query: {} },
        signal,
      }),
    [streamsRepositoryClient]
  );

  const {
    data: featuresData,
    isLoading: featuresLoading,
    refetch: refetchFeatures,
  } = useFetchFeatures();
  const featuresCount = featuresData?.features?.length ?? 0;

  const {
    data: queriesData,
    isLoading: queriesLoading,
    refetch: refetchQueries,
  } = useFetchDiscoveryQueries({
    page: 1,
    perPage: 1,
  });
  const queriesCount = queriesData?.total ?? 0;

  const [topologyCode, setTopologyCode] = useState<string | null>(null);
  const [topologyLoading, setTopologyLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const loadTopology = async () => {
      try {
        const result = await streamsRepositoryClient.fetch('GET /internal/streams/_topology', {});
        if (!cancelled && result.mermaid) {
          setTopologyCode(result.mermaid);
        }
      } catch {
        // No persisted topology
      } finally {
        if (!cancelled) setTopologyLoading(false);
      }
    };
    loadTopology();
    return () => {
      cancelled = true;
    };
  }, [streamsRepositoryClient]);

  const discoveries = (discoveriesFetch.value ?? []) as Discovery[];
  const suggestions = (suggestionsFetch.value ?? []) as Suggestion[];

  // Top Discoveries: sorted by relevance_score descending (highest relevance first).
  // relevance_score (0-100) is LLM-assigned based on: impact breadth (30%),
  // evidence confidence (25%), novelty (25%), actionability (20%).
  const topDiscoveries = useMemo(
    () =>
      [...discoveries]
        .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
        .slice(0, 3),
    [discoveries]
  );

  // Top Recommendations: collected from all discoveries' embedded recommendations[],
  // sorted by priority (critical > high > medium > low). Each recommendation is
  // tagged with its source discovery for context.
  const topRecommendations = useMemo(() => {
    const all: RankedRecommendation[] = [];
    for (const d of discoveries) {
      if (d.recommendations) {
        for (const rec of d.recommendations) {
          all.push({
            ...rec,
            discoveryTitle: d.title,
            discoverySeverity: d.severity,
          });
        }
      }
    }
    return all
      .sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3))
      .slice(0, 3);
  }, [discoveries]);

  // Top Suggestions: sorted by priority (critical > high > medium > low).
  // Priority is derived from the source discovery's severity and relevance_score
  // during Stage 3 of the pipeline.
  const topSuggestions = useMemo(
    () =>
      [...suggestions]
        .sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3))
        .slice(0, 3),
    [suggestions]
  );

  const pendingSuggestions = suggestions.filter((s) => s.status === 'pending');
  const isLoading =
    discoveriesFetch.loading || suggestionsFetch.loading || featuresLoading || queriesLoading;

  const uniqueStreams = useMemo(() => {
    const streams = new Set<string>();
    for (const d of discoveries) {
      for (const ref of d.stream_refs) {
        streams.add(ref);
      }
    }
    for (const s of suggestions) {
      for (const ref of s.stream_refs) {
        streams.add(ref);
      }
    }
    return streams.size;
  }, [discoveries, suggestions]);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        discoveriesFetch.refresh(),
        suggestionsFetch.refresh(),
        refetchFeatures(),
        refetchQueries(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [discoveriesFetch, suggestionsFetch, refetchFeatures, refetchQueries]);

  if (isLoading) {
    return (
      <EuiFlexGroup justifyContent="center" alignItems="center" style={{ minHeight: 300 }}>
        <EuiFlexItem grow={false}>
          <EuiLoadingSpinner size="xl" />
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

  if (discoveries.length === 0 && suggestions.length === 0) {
    return (
      <EuiEmptyPrompt
        icon={<EuiIcon type="discoverApp" size="xxl" />}
        title={
          <h2>
            {i18n.translate('xpack.streams.overview.emptyTitle', {
              defaultMessage: 'Welcome to Significant Events Discovery',
            })}
          </h2>
        }
        body={
          <p>
            {i18n.translate('xpack.streams.overview.emptyDescription', {
              defaultMessage:
                'No discoveries or suggestions yet. Go to the Discoveries tab to generate your first analysis, or use the Agent Builder to explore your streams.',
            })}
          </p>
        }
        actions={[
          <EuiLink href={router.link('/_discovery/{tab}', { path: { tab: 'discoveries' } })}>
            {i18n.translate('xpack.streams.overview.goToDiscoveries', {
              defaultMessage: 'Go to Discoveries',
            })}
          </EuiLink>,
        ]}
      />
    );
  }

  return (
    <EuiFlexGroup direction="column" gutterSize="l">
      {/* Refresh button */}
      <EuiFlexItem grow={false}>
        <EuiFlexGroup justifyContent="flexEnd">
          <EuiFlexItem grow={false}>
            <EuiButton
              iconType="refresh"
              onClick={handleRefresh}
              isLoading={isRefreshing}
              isDisabled={isRefreshing}
              size="s"
            >
              {i18n.translate('xpack.streams.overview.refreshButton', {
                defaultMessage: 'Refresh',
              })}
            </EuiButton>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>

      {/* Summary stats */}
      <EuiFlexItem grow={false}>
        <EuiFlexGroup gutterSize="l">
          <EuiFlexItem>
            <EuiPanel hasBorder paddingSize="l">
              <EuiStat
                title={discoveries.length}
                description={i18n.translate('xpack.streams.overview.totalDiscoveries', {
                  defaultMessage: 'Discoveries',
                })}
                titleColor="primary"
              />
            </EuiPanel>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiPanel hasBorder paddingSize="l">
              <EuiStat
                title={`${suggestions.length} / ${pendingSuggestions.length}`}
                description={i18n.translate('xpack.streams.overview.suggestionsAndPending', {
                  defaultMessage: 'Suggestions / pending review',
                })}
                titleColor="accent"
              />
            </EuiPanel>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiPanel hasBorder paddingSize="l">
              <EuiStat
                title={featuresCount}
                description={i18n.translate('xpack.streams.overview.totalFeatures', {
                  defaultMessage: 'Features',
                })}
                titleColor="subdued"
              />
            </EuiPanel>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiPanel hasBorder paddingSize="l">
              <EuiStat
                title={queriesCount}
                description={i18n.translate('xpack.streams.overview.totalQueries', {
                  defaultMessage: 'Queries',
                })}
                titleColor="subdued"
              />
            </EuiPanel>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiPanel hasBorder paddingSize="l">
              <EuiStat
                title={uniqueStreams}
                description={i18n.translate('xpack.streams.overview.streamsAnalyzed', {
                  defaultMessage: 'Streams analyzed',
                })}
                titleColor="subdued"
              />
            </EuiPanel>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlexItem>

      {/* Top Discoveries */}
      {topDiscoveries.length > 0 && (
        <EuiFlexItem grow={false}>
          <EuiFlexGroup justifyContent="spaceBetween" alignItems="center">
            <EuiFlexItem grow={false}>
              <EuiTitle size="s">
                <h3>
                  <EuiIcon type="crosshairs" />{' '}
                  {i18n.translate('xpack.streams.overview.topDiscoveries', {
                    defaultMessage: 'Top Discoveries',
                  })}
                </h3>
              </EuiTitle>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiLink href={router.link('/_discovery/{tab}', { path: { tab: 'discoveries' } })}>
                {i18n.translate('xpack.streams.overview.viewAllDiscoveries', {
                  defaultMessage: 'View all ({count})',
                  values: { count: discoveries.length },
                })}
              </EuiLink>
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiSpacer size="s" />
          <EuiFlexGroup gutterSize="m">
            {topDiscoveries.map((d) => (
              <EuiFlexItem key={d.uuid}>
                <EuiCard
                  layout="horizontal"
                  titleSize="xs"
                  title={
                    <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
                      <EuiFlexItem grow={false}>
                        <EuiBadge color={severityColors[d.severity] ?? 'hollow'}>
                          {d.severity}
                        </EuiBadge>
                      </EuiFlexItem>
                      <EuiFlexItem>{d.title}</EuiFlexItem>
                    </EuiFlexGroup>
                  }
                  description=""
                  paddingSize="m"
                  hasBorder
                >
                  <EuiText size="xs" color="subdued">
                    <p>
                      {d.description.length > 150
                        ? `${d.description.slice(0, 150)}...`
                        : d.description}
                    </p>
                  </EuiText>
                  <EuiSpacer size="xs" />
                  <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                    <EuiFlexItem grow={false}>
                      <EuiBadge color="hollow">
                        {i18n.translate('xpack.streams.overview.relevance', {
                          defaultMessage: 'Relevance: {score}',
                          values: { score: d.relevance_score },
                        })}
                      </EuiBadge>
                    </EuiFlexItem>
                    {d.stream_refs.slice(0, 2).map((ref) => (
                      <EuiFlexItem grow={false} key={ref}>
                        <EuiBadge color="hollow">{ref}</EuiBadge>
                      </EuiFlexItem>
                    ))}
                    {d.stream_refs.length > 2 && (
                      <EuiFlexItem grow={false}>
                        <EuiText size="xs" color="subdued">
                          +{d.stream_refs.length - 2}
                        </EuiText>
                      </EuiFlexItem>
                    )}
                  </EuiFlexGroup>
                </EuiCard>
              </EuiFlexItem>
            ))}
          </EuiFlexGroup>
        </EuiFlexItem>
      )}

      {/* Top Recommendations */}
      {topRecommendations.length > 0 && (
        <EuiFlexItem grow={false}>
          <EuiFlexGroup justifyContent="spaceBetween" alignItems="center">
            <EuiFlexItem grow={false}>
              <EuiTitle size="s">
                <h3>
                  <EuiIcon type="checkInCircleFilled" />{' '}
                  {i18n.translate('xpack.streams.overview.topRecommendations', {
                    defaultMessage: 'Top Recommendations',
                  })}
                </h3>
              </EuiTitle>
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiSpacer size="s" />
          <EuiFlexGroup gutterSize="m">
            {topRecommendations.map((rec, idx) => (
              <EuiFlexItem key={idx}>
                <EuiCard
                  layout="horizontal"
                  titleSize="xs"
                  title={
                    <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
                      <EuiFlexItem grow={false}>
                        <EuiBadge color={severityColors[rec.priority] ?? 'hollow'}>
                          {rec.priority}
                        </EuiBadge>
                      </EuiFlexItem>
                      <EuiFlexItem>{rec.title}</EuiFlexItem>
                    </EuiFlexGroup>
                  }
                  description=""
                  paddingSize="m"
                  hasBorder
                >
                  <EuiMarkdownFormat textSize="xs">
                    {rec.description.length > 200
                      ? `${rec.description.slice(0, 200)}...`
                      : rec.description}
                  </EuiMarkdownFormat>
                  <EuiSpacer size="xs" />
                  <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                    <EuiFlexItem grow={false}>
                      <EuiBadge color="hollow">
                        {i18n.translate('xpack.streams.overview.stepsCount', {
                          defaultMessage: '{count} {count, plural, one {step} other {steps}}',
                          values: { count: rec.steps.length },
                        })}
                      </EuiBadge>
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiText size="xs" color="subdued">
                        {i18n.translate('xpack.streams.overview.fromDiscovery', {
                          defaultMessage: 'From: {title}',
                          values: {
                            title:
                              rec.discoveryTitle.length > 40
                                ? `${rec.discoveryTitle.slice(0, 40)}...`
                                : rec.discoveryTitle,
                          },
                        })}
                      </EuiText>
                    </EuiFlexItem>
                  </EuiFlexGroup>
                </EuiCard>
              </EuiFlexItem>
            ))}
          </EuiFlexGroup>
        </EuiFlexItem>
      )}

      {/* Top Suggestions */}
      {topSuggestions.length > 0 && (
        <EuiFlexItem grow={false}>
          <EuiFlexGroup justifyContent="spaceBetween" alignItems="center">
            <EuiFlexItem grow={false}>
              <EuiTitle size="s">
                <h3>
                  <EuiIcon type="editorCodeBlock" />{' '}
                  {i18n.translate('xpack.streams.overview.topSuggestions', {
                    defaultMessage: 'Top Suggestions',
                  })}
                </h3>
              </EuiTitle>
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiLink href={router.link('/_discovery/{tab}', { path: { tab: 'suggestions' } })}>
                {i18n.translate('xpack.streams.overview.viewAllSuggestions', {
                  defaultMessage: 'View all ({count})',
                  values: { count: suggestions.length },
                })}
              </EuiLink>
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiSpacer size="s" />
          <EuiFlexGroup gutterSize="m">
            {topSuggestions.map((s) => (
              <EuiFlexItem key={s.uuid}>
                <EuiCard
                  layout="horizontal"
                  titleSize="xs"
                  title={
                    <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
                      <EuiFlexItem grow={false}>
                        <EuiIcon type={typeIcons[s.type] ?? 'document'} />
                      </EuiFlexItem>
                      <EuiFlexItem grow={false}>
                        <EuiBadge color={severityColors[s.priority] ?? 'hollow'}>
                          {s.priority}
                        </EuiBadge>
                      </EuiFlexItem>
                      <EuiFlexItem>{s.title}</EuiFlexItem>
                    </EuiFlexGroup>
                  }
                  description=""
                  paddingSize="m"
                  hasBorder
                >
                  {s.esql_query && (
                    <EuiCodeBlock
                      language="esql"
                      paddingSize="s"
                      fontSize="s"
                      overflowHeight={60}
                      isCopyable
                    >
                      {s.esql_query}
                    </EuiCodeBlock>
                  )}
                  <EuiSpacer size="xs" />
                  <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                    <EuiFlexItem grow={false}>
                      <EuiBadge>{typeLabels[s.type] ?? s.type}</EuiBadge>
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiBadge
                        color={
                          s.status === 'accepted'
                            ? 'success'
                            : s.status === 'dismissed'
                            ? 'danger'
                            : 'default'
                        }
                      >
                        {s.status}
                      </EuiBadge>
                    </EuiFlexItem>
                  </EuiFlexGroup>
                </EuiCard>
              </EuiFlexItem>
            ))}
          </EuiFlexGroup>
        </EuiFlexItem>
      )}

      {/* Topology */}
      <EuiFlexItem grow={false}>
        <EuiFlexGroup justifyContent="spaceBetween" alignItems="center">
          <EuiFlexItem grow={false}>
            <EuiTitle size="s">
              <h3>
                <EuiIcon type="visVega" />{' '}
                {i18n.translate('xpack.streams.overview.topology', {
                  defaultMessage: 'Topology',
                })}
              </h3>
            </EuiTitle>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiLink href={router.link('/_discovery/{tab}', { path: { tab: 'topology' } })}>
              {i18n.translate('xpack.streams.overview.viewTopology', {
                defaultMessage: 'View full topology',
              })}
            </EuiLink>
          </EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        {topologyLoading ? (
          <EuiFlexGroup justifyContent="center" alignItems="center" style={{ minHeight: 100 }}>
            <EuiFlexItem grow={false}>
              <EuiLoadingSpinner size="l" />
            </EuiFlexItem>
          </EuiFlexGroup>
        ) : topologyCode ? (
          <MermaidDiagram code={topologyCode} />
        ) : (
          <EuiPanel color="subdued" paddingSize="l">
            <EuiText size="s" color="subdued" textAlign="center">
              {i18n.translate('xpack.streams.overview.noTopology', {
                defaultMessage:
                  'No topology diagram generated yet. Go to the Topology tab to generate one.',
              })}
            </EuiText>
          </EuiPanel>
        )}
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}
