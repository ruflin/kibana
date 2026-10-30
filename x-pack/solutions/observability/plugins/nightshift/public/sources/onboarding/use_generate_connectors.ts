/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { InferenceConnector } from '@kbn/inference-common';
import { GEN_AI_SETTINGS_DEFAULT_AI_CONNECTOR_DEFAULT_ONLY } from '@kbn/management-settings-ids';
import { useCallback, useMemo } from 'react';
import { useKibana } from '../../hooks/use_kibana';
import type { OnboardingConfig } from './types';

interface UseGenerateConnectorsOptions {
  config: OnboardingConfig;
  allConnectors: InferenceConnector[];
  onConfigChange: (config: OnboardingConfig) => void;
}

/** The connectors picked for the features and queries steps, and the handlers that change them. */
export const useGenerateConnectors = ({
  config,
  allConnectors,
  onConfigChange,
}: UseGenerateConnectorsOptions) => {
  const { settings } = useKibana().services;
  const defaultConnectorOnly = settings.client.get<boolean>(
    GEN_AI_SETTINGS_DEFAULT_AI_CONNECTOR_DEFAULT_ONLY,
    false
  );

  const featuresConnector = useMemo(
    () => allConnectors.find((connector) => connector.connectorId === config.connectors.features),
    [allConnectors, config.connectors.features]
  );
  const queriesConnector = useMemo(
    () => allConnectors.find((connector) => connector.connectorId === config.connectors.queries),
    [allConnectors, config.connectors.queries]
  );

  const onSelectFeaturesConnector = useCallback(
    (connectorId: string) => {
      onConfigChange({
        ...config,
        connectors: { ...config.connectors, features: connectorId },
      });
    },
    [config, onConfigChange]
  );

  const onSelectQueriesConnector = useCallback(
    (connectorId: string) => {
      onConfigChange({
        ...config,
        connectors: { ...config.connectors, queries: connectorId },
      });
    },
    [config, onConfigChange]
  );

  return {
    defaultConnectorOnly,
    featuresConnector,
    queriesConnector,
    onSelectFeaturesConnector,
    onSelectQueriesConnector,
  };
};
