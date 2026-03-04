/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { IUiSettingsClient, Logger } from '@kbn/core/server';
import { GEN_AI_SETTINGS_DEFAULT_AI_CONNECTOR } from '@kbn/management-settings-ids';

/**
 * Resolves the connector ID to use for AI operations.
 *
 * If a connectorId is provided, it will be used.
 * Otherwise, it will check the uiSettings for a default AI connector.
 * Falls back to a hardcoded POC connector if none is configured.
 *
 * @param connectorId - Optional connector ID provided by the client
 * @param uiSettingsClient - UI settings client to fetch the default connector setting
 * @returns The resolved connector ID
 */

// TODO: Import from gen-ai-settings-plugin (package) once available
const NO_DEFAULT_CONNECTOR = 'NO_DEFAULT_CONNECTOR';

export async function resolveConnectorId({
  connectorId,
  uiSettingsClient,
  logger,
}: {
  connectorId?: string;
  uiSettingsClient: IUiSettingsClient;
  logger: Logger;
}): Promise<string> {
  if (connectorId) {
    return connectorId;
  }

  const defaultConnector = await uiSettingsClient.get<string>(GEN_AI_SETTINGS_DEFAULT_AI_CONNECTOR);

  if (defaultConnector && defaultConnector !== NO_DEFAULT_CONNECTOR) {
    logger.debug(`No connector ID provided, using default AI connector: ${defaultConnector}`);
    return defaultConnector;
  }

  // POC hardcoded fallback — use the local Anthropic connector when no default is configured
  const HARDCODED_FALLBACK_CONNECTOR = 'anthropic-claude-4-6-sonnet';
  logger.debug(
    `No connector ID provided and no default configured, falling back to hardcoded connector: ${HARDCODED_FALLBACK_CONNECTOR}`
  );
  return HARDCODED_FALLBACK_CONNECTOR;
}
