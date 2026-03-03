/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useMemo, useState } from 'react';
import {
  EuiBadge,
  EuiBasicTable,
  EuiDescriptionList,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiIcon,
  EuiListGroup,
  EuiListGroupItem,
  EuiLoadingElastic,
  EuiPanel,
  EuiSpacer,
  EuiText,
  EuiTitle,
  type EuiBasicTableColumn,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { Discovery, DiscoveryEvidence, Recommendation } from '@kbn/streams-schema';
import { useKibana } from '../../../../hooks/use_kibana';
import { useStreamsAppFetch } from '../../../../hooks/use_streams_app_fetch';
import { Summary } from './summary';

const severityColors: Record<string, 'danger' | 'warning' | 'primary' | 'hollow'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'primary',
  low: 'hollow',
};

const formatDate = (date: string): string => {
  try {
    return new Date(date).toLocaleString();
  } catch {
    return date;
  }
};

function DiscoveryDetailFlyout({
  discovery,
  onClose,
}: {
  discovery: Discovery;
  onClose: () => void;
}) {
  return (
    <EuiFlyout onClose={onClose} size="m">
      <EuiFlyoutHeader hasBorder>
        <EuiFlexGroup alignItems="center" gutterSize="m">
          <EuiFlexItem grow={false}>
            <EuiBadge color={severityColors[discovery.severity] ?? 'hollow'}>
              {discovery.severity}
            </EuiBadge>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiTitle size="m">
              <h2>{discovery.title}</h2>
            </EuiTitle>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        <EuiDescriptionList
          type="column"
          compressed
          listItems={[
            {
              title: i18n.translate('xpack.streams.discoveryDetail.relevance', {
                defaultMessage: 'Relevance',
              }),
              description: `${discovery.relevance_score}/100`,
            },
            {
              title: i18n.translate('xpack.streams.discoveryDetail.level', {
                defaultMessage: 'Level',
              }),
              description: String(discovery.level),
            },
            {
              title: i18n.translate('xpack.streams.discoveryDetail.created', {
                defaultMessage: 'Created',
              }),
              description: formatDate(discovery.created_at),
            },
            {
              title: i18n.translate('xpack.streams.discoveryDetail.updated', {
                defaultMessage: 'Updated',
              }),
              description: formatDate(discovery.updated_at),
            },
          ]}
        />

        <EuiSpacer size="l" />

        <EuiTitle size="xs">
          <h3>
            {i18n.translate('xpack.streams.discoveryDetail.description', {
              defaultMessage: 'Description',
            })}
          </h3>
        </EuiTitle>
        <EuiSpacer size="s" />
        <EuiText size="s">
          <p>{discovery.description}</p>
        </EuiText>

        {discovery.stream_refs.length > 0 && (
          <>
            <EuiSpacer size="l" />
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.discoveryDetail.streams', {
                  defaultMessage: 'Streams',
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiFlexGroup gutterSize="xs" wrap>
              {discovery.stream_refs.map((ref) => (
                <EuiFlexItem grow={false} key={ref}>
                  <EuiBadge>{ref}</EuiBadge>
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
          </>
        )}

        {discovery.tags && discovery.tags.length > 0 && (
          <>
            <EuiSpacer size="l" />
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.discoveryDetail.tags', {
                  defaultMessage: 'Tags',
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiFlexGroup gutterSize="xs" wrap>
              {discovery.tags.map((tag) => (
                <EuiFlexItem grow={false} key={tag}>
                  <EuiBadge color="hollow">{tag}</EuiBadge>
                </EuiFlexItem>
              ))}
            </EuiFlexGroup>
          </>
        )}

        {discovery.evidence.length > 0 && (
          <>
            <EuiSpacer size="l" />
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.discoveryDetail.evidence', {
                  defaultMessage: 'Evidence ({count})',
                  values: { count: discovery.evidence.length },
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            {discovery.evidence.map((ev: DiscoveryEvidence, idx: number) => (
              <EuiPanel key={idx} paddingSize="s" hasBorder css={{ marginBottom: 8 }}>
                <EuiDescriptionList
                  type="column"
                  compressed
                  listItems={[
                    {
                      title: i18n.translate('xpack.streams.discoveryDetail.evidenceStream', {
                        defaultMessage: 'Stream',
                      }),
                      description: ev.stream_name,
                    },
                    {
                      title: i18n.translate('xpack.streams.discoveryDetail.evidenceQuery', {
                        defaultMessage: 'Query',
                      }),
                      description: ev.query_title,
                    },
                    {
                      title: i18n.translate('xpack.streams.discoveryDetail.evidenceCount', {
                        defaultMessage: 'Events',
                      }),
                      description: String(ev.event_count),
                    },
                    ...(ev.change_point_type
                      ? [
                          {
                            title: i18n.translate(
                              'xpack.streams.discoveryDetail.evidenceChangePoint',
                              { defaultMessage: 'Change point' }
                            ),
                            description: `${ev.change_point_type}${ev.change_point_p_value != null ? ` (p=${ev.change_point_p_value})` : ''}`,
                          },
                        ]
                      : []),
                    ...(ev.feature_name
                      ? [
                          {
                            title: i18n.translate(
                              'xpack.streams.discoveryDetail.evidenceFeature',
                              { defaultMessage: 'Feature' }
                            ),
                            description: ev.feature_name,
                          },
                        ]
                      : []),
                  ]}
                />
              </EuiPanel>
            ))}
          </>
        )}

        {discovery.recommendations && discovery.recommendations.length > 0 && (
          <>
            <EuiSpacer size="l" />
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.discoveryDetail.recommendations', {
                  defaultMessage: 'Recommendations ({count})',
                  values: { count: discovery.recommendations.length },
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            {discovery.recommendations.map((rec: Recommendation, idx: number) => (
              <EuiPanel key={idx} paddingSize="s" hasBorder css={{ marginBottom: 8 }}>
                <EuiFlexGroup alignItems="center" gutterSize="s">
                  <EuiFlexItem grow={false}>
                    <EuiBadge color={severityColors[rec.priority] ?? 'hollow'}>
                      {rec.priority}
                    </EuiBadge>
                  </EuiFlexItem>
                  <EuiFlexItem>
                    <EuiText size="s">
                      <strong>{rec.title}</strong>
                    </EuiText>
                  </EuiFlexItem>
                </EuiFlexGroup>
                <EuiSpacer size="xs" />
                <EuiText size="xs" color="subdued">
                  {rec.description}
                </EuiText>
                {rec.steps.length > 0 && (
                  <>
                    <EuiSpacer size="xs" />
                    <EuiListGroup flush maxWidth={false}>
                      {rec.steps.map((step, stepIdx) => (
                        <EuiListGroupItem
                          key={stepIdx}
                          label={`${stepIdx + 1}. ${step}`}
                          size="xs"
                        />
                      ))}
                    </EuiListGroup>
                  </>
                )}
              </EuiPanel>
            ))}
          </>
        )}

        {(discovery.query_refs?.length || discovery.feature_refs?.length || discovery.discovery_refs?.length) && (
          <>
            <EuiSpacer size="l" />
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.discoveryDetail.references', {
                  defaultMessage: 'References',
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiDescriptionList
              type="column"
              compressed
              listItems={[
                ...(discovery.query_refs?.length
                  ? [
                      {
                        title: i18n.translate('xpack.streams.discoveryDetail.queryRefs', {
                          defaultMessage: 'Queries',
                        }),
                        description: discovery.query_refs.join(', '),
                      },
                    ]
                  : []),
                ...(discovery.feature_refs?.length
                  ? [
                      {
                        title: i18n.translate('xpack.streams.discoveryDetail.featureRefs', {
                          defaultMessage: 'Features',
                        }),
                        description: discovery.feature_refs.join(', '),
                      },
                    ]
                  : []),
                ...(discovery.discovery_refs?.length
                  ? [
                      {
                        title: i18n.translate('xpack.streams.discoveryDetail.discoveryRefs', {
                          defaultMessage: 'Related discoveries',
                        }),
                        description: discovery.discovery_refs.join(', '),
                      },
                    ]
                  : []),
              ]}
            />
          </>
        )}

        {discovery.feedback && (
          <>
            <EuiSpacer size="l" />
            <EuiDescriptionList
              type="column"
              compressed
              listItems={[
                {
                  title: i18n.translate('xpack.streams.discoveryDetail.feedback', {
                    defaultMessage: 'Feedback',
                  }),
                  description: (
                    <EuiBadge color={discovery.feedback === 'useful' ? 'success' : 'danger'}>
                      {discovery.feedback}
                    </EuiBadge>
                  ),
                },
              ]}
            />
          </>
        )}
      </EuiFlyoutBody>
    </EuiFlyout>
  );
}

export function DiscoveriesTab() {
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
  } = useKibana();

  const [selectedDiscovery, setSelectedDiscovery] = useState<Discovery | null>(null);

  const discoveriesFetch = useStreamsAppFetch(
    async ({ signal }) =>
      streamsRepositoryClient.fetch('GET /internal/streams/_discoveries', {
        params: { query: {} },
        signal,
      }),
    [streamsRepositoryClient]
  );

  const queriesFetch = useStreamsAppFetch(
    async ({ signal }) =>
      streamsRepositoryClient.fetch('GET /internal/streams/_queries', {
        params: {
          query: {
            from: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
            to: new Date().toISOString(),
            bucketSize: '30s',
          },
        },
        signal,
      }),
    [streamsRepositoryClient]
  );

  const columns: Array<EuiBasicTableColumn<Discovery>> = useMemo(
    () => [
      {
        field: 'severity',
        name: i18n.translate('xpack.streams.discoveries.severityColumn', {
          defaultMessage: 'Severity',
        }),
        width: '100px',
        render: (severity: string) => (
          <EuiBadge color={severityColors[severity] ?? 'hollow'}>{severity}</EuiBadge>
        ),
      },
      {
        field: 'title',
        name: i18n.translate('xpack.streams.discoveries.titleColumn', {
          defaultMessage: 'Title',
        }),
      },
      {
        field: 'relevance_score',
        name: i18n.translate('xpack.streams.discoveries.relevanceColumn', {
          defaultMessage: 'Relevance',
        }),
        width: '100px',
        render: (score: number) => `${score}/100`,
      },
      {
        field: 'level',
        name: i18n.translate('xpack.streams.discoveries.levelColumn', {
          defaultMessage: 'Level',
        }),
        width: '80px',
      },
      {
        field: 'stream_refs',
        name: i18n.translate('xpack.streams.discoveries.streamsColumn', {
          defaultMessage: 'Streams',
        }),
        render: (refs: string[]) => refs?.join(', ') ?? '',
      },
      {
        field: 'created_at',
        name: i18n.translate('xpack.streams.discoveries.createdColumn', {
          defaultMessage: 'Created',
        }),
        width: '180px',
        render: (date: string) => formatDate(date),
      },
    ],
    []
  );

  if (discoveriesFetch.loading || queriesFetch.loading) {
    return <EuiLoadingElastic />;
  }

  const discoveries = (discoveriesFetch.value ?? []) as Discovery[];
  const totalEvents = queriesFetch.value?.total ?? 0;

  if (discoveries.length > 0) {
    return (
      <>
        <EuiFlexGroup direction="column" gutterSize="l">
          <EuiFlexItem>
            <Summary
              count={totalEvents}
              onDiscoveriesGenerated={() => discoveriesFetch.refresh()}
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiTitle size="xs">
              <h3>
                {i18n.translate('xpack.streams.discoveries.persistedTitle', {
                  defaultMessage: 'Persisted Discoveries ({count})',
                  values: { count: discoveries.length },
                })}
              </h3>
            </EuiTitle>
            <EuiSpacer size="s" />
            <EuiBasicTable
              items={discoveries}
              columns={columns}
              rowProps={(item) => ({
                onClick: () => setSelectedDiscovery(item),
                style: { cursor: 'pointer' },
              })}
            />
          </EuiFlexItem>
        </EuiFlexGroup>

        {selectedDiscovery && (
          <DiscoveryDetailFlyout
            discovery={selectedDiscovery}
            onClose={() => setSelectedDiscovery(null)}
          />
        )}
      </>
    );
  }

  if (totalEvents === 0) {
    return (
      <EuiFlexGroup direction="column" alignItems="center" justifyContent="center">
        <EuiFlexItem grow={false}>
          <EuiPanel color="subdued">
            <EuiFlexGroup
              direction="column"
              alignItems="center"
              justifyContent="center"
              style={{ minHeight: '30vh', minWidth: '40vh' }}
            >
              <EuiFlexItem grow={false}>
                <EuiIcon type="createAdvancedJob" size="xxl" aria-hidden={true} />
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiTitle size="s">
                  <h2>
                    {i18n.translate(
                      'xpack.streams.sigEventsDiscovery.discoveriesTab.noEventsFoundTitle',
                      {
                        defaultMessage: 'No events found to analyze',
                      }
                    )}
                  </h2>
                </EuiTitle>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiText size="s" textAlign="center" css={{ maxWidth: 400 }}>
                  {i18n.translate(
                    'xpack.streams.sigEventsDiscovery.discoveriesTab.noEventsFoundDescription',
                    {
                      defaultMessage:
                        'Newly created queries need time to collect data before analysis can begin.',
                    }
                  )}
                </EuiText>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiPanel>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

  return (
    <Summary count={totalEvents} onDiscoveriesGenerated={() => discoveriesFetch.refresh()} />
  );
}
