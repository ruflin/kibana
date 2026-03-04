/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  EuiButton,
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiLoadingElastic,
  EuiPanel,
  EuiSpacer,
  EuiSuperSelect,
  EuiSwitch,
  EuiText,
  EuiTitle,
} from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import { useKibana } from '../../../../hooks/use_kibana';
import { useGenAIConnectors } from '../../../../hooks/use_genai_connectors';
import { useStreamsAppFetch } from '../../../../hooks/use_streams_app_fetch';
import { ConnectorIcon } from '../../../connector_list_button/connector_icon';

const EMPTY_CONNECTOR_VALUE = '__use_default__';

interface DiscoverySettings {
  featureExtractionConnectorId?: string;
  queryGenerationConnectorId?: string;
  discoveryConnectorId?: string;
  suggestionConnectorId?: string;
  defaultConnectorId?: string;
  enableMetricsTraces?: boolean;
}

export function SettingsPage() {
  const {
    dependencies: {
      start: {
        streams: { streamsRepositoryClient },
      },
    },
    core,
  } = useKibana();

  const genAiConnectors = useGenAIConnectors({
    streamsRepositoryClient,
    uiSettings: core.uiSettings,
  });

  const settingsFetch = useStreamsAppFetch(
    async ({ signal }) =>
      streamsRepositoryClient.fetch('GET /internal/streams/_discovery/_settings', {
        signal,
      }) as Promise<DiscoverySettings>,
    [streamsRepositoryClient]
  );

  const [discoveryConnectorId, setDiscoveryConnectorId] = useState<string>(EMPTY_CONNECTOR_VALUE);
  const [featureExtractionConnectorId, setFeatureExtractionConnectorId] =
    useState<string>(EMPTY_CONNECTOR_VALUE);
  const [queryGenerationConnectorId, setQueryGenerationConnectorId] =
    useState<string>(EMPTY_CONNECTOR_VALUE);
  const [suggestionConnectorId, setSuggestionConnectorId] = useState<string>(EMPTY_CONNECTOR_VALUE);
  const [enableMetricsTraces, setEnableMetricsTraces] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (settingsFetch.value) {
      const s = settingsFetch.value;
      setDiscoveryConnectorId(s.discoveryConnectorId ?? EMPTY_CONNECTOR_VALUE);
      setFeatureExtractionConnectorId(s.featureExtractionConnectorId ?? EMPTY_CONNECTOR_VALUE);
      setQueryGenerationConnectorId(s.queryGenerationConnectorId ?? EMPTY_CONNECTOR_VALUE);
      setSuggestionConnectorId(s.suggestionConnectorId ?? EMPTY_CONNECTOR_VALUE);
      setEnableMetricsTraces(s.enableMetricsTraces ?? false);
    }
  }, [settingsFetch.value]);

  const connectorOptions = useMemo(() => {
    const defaultOption = {
      value: EMPTY_CONNECTOR_VALUE,
      inputDisplay: i18n.translate('xpack.streams.sigDiscovery.settings.useDefault', {
        defaultMessage: 'Use global default',
      }),
      dropdownDisplay: (
        <EuiText size="s" color="subdued">
          {i18n.translate('xpack.streams.sigDiscovery.settings.useDefaultDropdown', {
            defaultMessage: 'Use global default connector',
          })}
        </EuiText>
      ),
    };

    const connectorItems = (genAiConnectors.connectors ?? []).map((connector) => ({
      value: connector.id,
      inputDisplay: (
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <ConnectorIcon connectorName={connector.name} />
          </EuiFlexItem>
          <EuiFlexItem>{connector.name}</EuiFlexItem>
        </EuiFlexGroup>
      ),
      dropdownDisplay: (
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}>
            <ConnectorIcon connectorName={connector.name} />
          </EuiFlexItem>
          <EuiFlexItem>{connector.name}</EuiFlexItem>
        </EuiFlexGroup>
      ),
    }));

    return [defaultOption, ...connectorItems];
  }, [genAiConnectors.connectors]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const toSend = (val: string) => (val === EMPTY_CONNECTOR_VALUE ? undefined : val);

      await streamsRepositoryClient.fetch('PUT /internal/streams/_discovery/_settings', {
        params: {
          body: {
            discoveryConnectorId: toSend(discoveryConnectorId),
            featureExtractionConnectorId: toSend(featureExtractionConnectorId),
            queryGenerationConnectorId: toSend(queryGenerationConnectorId),
            suggestionConnectorId: toSend(suggestionConnectorId),
            enableMetricsTraces,
          },
        },
      });
      setSaveSuccess(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [
    streamsRepositoryClient,
    discoveryConnectorId,
    featureExtractionConnectorId,
    queryGenerationConnectorId,
    suggestionConnectorId,
    enableMetricsTraces,
  ]);

  if (settingsFetch.loading || genAiConnectors.loading) {
    return <EuiLoadingElastic />;
  }

  return (
    <EuiFlexGroup direction="column" gutterSize="l">
      <EuiFlexItem>
        <EuiPanel hasBorder>
          <EuiTitle size="s">
            <h3>
              {i18n.translate('xpack.streams.sigDiscovery.settings.title', {
                defaultMessage: 'SigDiscovery Settings',
              })}
            </h3>
          </EuiTitle>
          <EuiSpacer size="m" />
          <EuiText size="s">
            {i18n.translate('xpack.streams.sigDiscovery.settings.description', {
              defaultMessage:
                'Configure the AI connectors used for each stage of the discovery pipeline. Leave empty to use the global default connector.',
            })}
          </EuiText>
          <EuiSpacer size="l" />

          {genAiConnectors.connectors?.length === 0 && (
            <>
              <EuiCallOut
                title={i18n.translate('xpack.streams.sigDiscovery.settings.noConnectors', {
                  defaultMessage: 'No AI connectors found',
                })}
                color="warning"
                iconType="warning"
              >
                <p>
                  {i18n.translate('xpack.streams.sigDiscovery.settings.noConnectorsDescription', {
                    defaultMessage:
                      'Create an AI connector in Stack Management > Connectors to use the discovery pipeline.',
                  })}
                </p>
              </EuiCallOut>
              <EuiSpacer size="l" />
            </>
          )}

          <EuiFlexGroup direction="column" gutterSize="l">
            <EuiFlexItem>
              <EuiFormRow
                label={i18n.translate(
                  'xpack.streams.sigDiscovery.settings.enableMetricsTracesLabel',
                  { defaultMessage: 'Enable metrics and traces' }
                )}
                helpText={i18n.translate(
                  'xpack.streams.sigDiscovery.settings.enableMetricsTracesHelp',
                  {
                    defaultMessage:
                      'When enabled, feature extraction and sig events discovery will also process metrics and traces streams. Off by default.',
                  }
                )}
                fullWidth
              >
                <EuiSwitch
                  label={i18n.translate(
                    'xpack.streams.sigDiscovery.settings.enableMetricsTracesSwitch',
                    { defaultMessage: 'Enable metrics and traces' }
                  )}
                  checked={enableMetricsTraces}
                  onChange={(e) => setEnableMetricsTraces(e.target.checked)}
                  data-test-subj="sigDiscoveryEnableMetricsTracesSwitch"
                />
              </EuiFormRow>
            </EuiFlexItem>

            <EuiFlexItem>
              <EuiFormRow
                label={i18n.translate('xpack.streams.sigDiscovery.settings.defaultConnectorLabel', {
                  defaultMessage: 'Default Connector',
                })}
                helpText={i18n.translate(
                  'xpack.streams.sigDiscovery.settings.defaultConnectorHelp',
                  {
                    defaultMessage:
                      'The default AI connector used for all pipeline stages unless overridden below.',
                  }
                )}
                fullWidth
              >
                <EuiSuperSelect
                  options={connectorOptions}
                  valueOfSelected={discoveryConnectorId}
                  onChange={setDiscoveryConnectorId}
                  fullWidth
                />
              </EuiFormRow>
            </EuiFlexItem>

            <EuiFlexItem>
              <EuiFormRow
                label={i18n.translate('xpack.streams.sigDiscovery.settings.stage1ConnectorLabel', {
                  defaultMessage: 'Stage 1: Extract Discoveries',
                })}
                helpText={i18n.translate(
                  'xpack.streams.sigDiscovery.settings.stage1ConnectorHelp',
                  {
                    defaultMessage:
                      'Connector for extracting base discoveries from significant event data.',
                  }
                )}
                fullWidth
              >
                <EuiSuperSelect
                  options={connectorOptions}
                  valueOfSelected={featureExtractionConnectorId}
                  onChange={setFeatureExtractionConnectorId}
                  fullWidth
                />
              </EuiFormRow>
            </EuiFlexItem>

            <EuiFlexItem>
              <EuiFormRow
                label={i18n.translate('xpack.streams.sigDiscovery.settings.stage2ConnectorLabel', {
                  defaultMessage: 'Stage 2: Enrich with Recommendations',
                })}
                helpText={i18n.translate(
                  'xpack.streams.sigDiscovery.settings.stage2ConnectorHelp',
                  {
                    defaultMessage:
                      'Connector for enriching discoveries with cross-stream correlations and recommendations.',
                  }
                )}
                fullWidth
              >
                <EuiSuperSelect
                  options={connectorOptions}
                  valueOfSelected={queryGenerationConnectorId}
                  onChange={setQueryGenerationConnectorId}
                  fullWidth
                />
              </EuiFormRow>
            </EuiFlexItem>

            <EuiFlexItem>
              <EuiFormRow
                label={i18n.translate('xpack.streams.sigDiscovery.settings.stage3ConnectorLabel', {
                  defaultMessage: 'Stage 3: Generate Suggestions',
                })}
                helpText={i18n.translate(
                  'xpack.streams.sigDiscovery.settings.stage3ConnectorHelp',
                  {
                    defaultMessage:
                      'Connector for generating ES|QL query suggestions from enriched discoveries.',
                  }
                )}
                fullWidth
              >
                <EuiSuperSelect
                  options={connectorOptions}
                  valueOfSelected={suggestionConnectorId}
                  onChange={setSuggestionConnectorId}
                  fullWidth
                />
              </EuiFormRow>
            </EuiFlexItem>
          </EuiFlexGroup>

          <EuiSpacer size="l" />

          {saveError && (
            <>
              <EuiCallOut
                title={i18n.translate('xpack.streams.sigDiscovery.settings.saveError', {
                  defaultMessage: 'Failed to save settings',
                })}
                color="danger"
                iconType="error"
              >
                <p>{saveError}</p>
              </EuiCallOut>
              <EuiSpacer size="m" />
            </>
          )}

          {saveSuccess && (
            <>
              <EuiCallOut
                title={i18n.translate('xpack.streams.sigDiscovery.settings.saveSuccess', {
                  defaultMessage: 'Settings saved successfully',
                })}
                color="success"
                iconType="check"
              />
              <EuiSpacer size="m" />
            </>
          )}

          <EuiButton fill onClick={handleSave} isLoading={saving}>
            {i18n.translate('xpack.streams.sigDiscovery.settings.save', {
              defaultMessage: 'Save settings',
            })}
          </EuiButton>
        </EuiPanel>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
}
