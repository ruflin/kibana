/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import type { ActionsClient } from '@kbn/actions-plugin/server';
import { ELASTIC_MANAGED_LLM_CONNECTOR_NAME } from '../../common/constants';

export async function getLlmConnectorId(
  actionsClient: ActionsClient,
  logger: Logger
): Promise<string> {
  try {
    // Get all available connectors
    const connectors = await actionsClient.getAll();

    // First, try to find the Elastic Managed LLM connector
    const elasticManagedConnector = connectors.find(
      (connector) => connector.name === ELASTIC_MANAGED_LLM_CONNECTOR_NAME
    );

    if (elasticManagedConnector) {
      logger.debug(
        `Found Elastic Managed LLM connector with ID: ${elasticManagedConnector.id}`
      );
      return elasticManagedConnector.id;
    }

    // If not found, look for any .inference connector with elastic provider
    const inferenceConnector = connectors.find(
      (connector) =>
        connector.actionTypeId === '.inference' &&
        (connector.config as any)?.provider === 'elastic'
    );

    if (inferenceConnector) {
      logger.debug(`Found inference connector with ID: ${inferenceConnector.id}`);
      return inferenceConnector.id;
    }

    // If still not found, try to find any .inference or .gen-ai connector
    const anyLlmConnector = connectors.find(
      (connector) =>
        connector.actionTypeId === '.inference' ||
        connector.actionTypeId === '.gen-ai'
    );

    if (anyLlmConnector) {
      logger.debug(`Found LLM connector with ID: ${anyLlmConnector.id}`);
      return anyLlmConnector.id;
    }

    throw new Error('No LLM connector found. Please configure an LLM connector.');
  } catch (error) {
    logger.error(`Failed to get LLM connector: ${error}`);
    throw error;
  }
}

