/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { schema } from '@kbn/config-schema';
import Path from 'path';
import Fs from 'fs';
import { load } from 'js-yaml';
import { mapValues } from 'lodash';
import { REPO_ROOT } from '@kbn/repo-info';
import { getPreDiscoveredEisModels } from './eis_helpers';

/**
 * The environment variable that is used by the CI to load the connectors configuration
 */
export const AI_CONNECTORS_VAR_ENV = 'KIBANA_TESTING_AI_CONNECTORS';

const connectorsSchema = schema.recordOf(
  schema.string(),
  schema.object({
    name: schema.string(),
    actionTypeId: schema.string(),
    config: schema.recordOf(schema.string(), schema.any()),
    secrets: schema.maybe(schema.recordOf(schema.string(), schema.any())),
  })
);

export interface AvailableConnector {
  name: string;
  actionTypeId: string;
  config: Record<string, unknown>;
  secrets?: Record<string, unknown>;
}

export interface AvailableConnectorWithId extends AvailableConnector {
  id: string;
}

/**
 * Try to read the connectors configuration from the local `config/kibana.dev.yml`
 * file. This allows developers to define `xpack.actions.preconfigured` connectors
 * in their local Kibana config without having to set the `KIBANA_TESTING_AI_CONNECTORS`
 * environment variable.
 */
const getConnectorsFromKibanaDevYml = (): Record<string, AvailableConnector> => {
  try {
    const configDir = Path.join(REPO_ROOT, './config');

    const kibanaDevConfigPath = Path.join(configDir, 'kibana.dev.yml');

    const configPath = Fs.existsSync(kibanaDevConfigPath) ? kibanaDevConfigPath : undefined;

    if (!configPath) {
      return {};
    }

    const parsedConfig = (load(Fs.readFileSync(configPath, 'utf8')) || {}) as Record<
      string,
      unknown
    >;

    const preconfiguredConnectors = (parsedConfig['xpack.actions.preconfigured'] || {}) as Record<
      string,
      AvailableConnector
    >;

    return mapValues(preconfiguredConnectors, ({ actionTypeId, config, name, secrets }) => {
      // make sure we don't send in any additional properties
      return {
        actionTypeId,
        config,
        name,
        secrets,
      };
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`Unable to read connectors from Kibana config file: ${(err as Error).message}`);
    return {};
  }
};

/**
 * Build preconfigured `.inference` connector entries from EIS models that were
 * discovered into `target/eis_models.json` (either by `scripts/discover_eis_models.js`
 * or by `enable_eis_ccm.js` after enabling Cloud Connected Mode).
 *
 * Returns an empty object when the file is missing — callers can unconditionally
 * spread the result.
 */
const getConnectorsFromEisModelsFile = (): Record<string, AvailableConnector> => {
  const models = getPreDiscoveredEisModels();
  const connectors: Record<string, AvailableConnector> = {};

  for (const model of models) {
    const connectorId = `eis-${model.modelId}`;
    connectors[connectorId] = {
      name: `EIS ${model.modelId}`,
      actionTypeId: '.inference',
      config: {
        provider: 'elastic',
        taskType: 'chat_completion',
        inferenceId: model.inferenceId,
      },
      secrets: {},
    };
  }

  return connectors;
};

const loadConnectors = (): Record<string, AvailableConnector> => {
  const envValue = process.env[AI_CONNECTORS_VAR_ENV];
  if (envValue) {
    let connectors: Record<string, AvailableConnector>;
    try {
      connectors = JSON.parse(Buffer.from(envValue, 'base64').toString('utf-8'));
    } catch (e) {
      throw new Error(
        `Error trying to parse value from ${AI_CONNECTORS_VAR_ENV} environment variable: ${
          (e as Error).message
        }`
      );
    }
    return connectorsSchema.validate(connectors);
  }

  // don't attempt to read local files on CI - CI must use KIBANA_TESTING_AI_CONNECTORS explicitly
  if (process.env.CI) {
    throw new Error(`Can't read connectors, env variable ${AI_CONNECTORS_VAR_ENV} is not set`);
  }

  // Locally, merge EIS-discovered connectors (from target/eis_models.json) with
  // any preconfigured ones declared in config/kibana.dev.yml. EIS connectors win
  // on id collisions, since they reflect the live CCM-provisioned endpoints.
  const merged = {
    ...getConnectorsFromKibanaDevYml(),
    ...getConnectorsFromEisModelsFile(),
  };

  return connectorsSchema.validate(merged);
};

/**
 * Retrieve the list of preconfigured connectors that should be used when defining the
 * FTR configuration of suites using the connectors.
 *
 * @example
 * ```ts
 * import { getPreconfiguredConnectorConfig } from '@kbn/gen-ai-functional-testing'
 *
 * export default async function ({ readConfigFile }: FtrConfigProviderContext) {
 *   const xpackFunctionalConfig = {...};
 *   const preconfiguredConnectors = getPreconfiguredConnectorConfig();
 *
 *   return {
 *     ...xpackFunctionalConfig.getAll(),
 *     kbnTestServer: {
 *       ...xpackFunctionalConfig.get('kbnTestServer'),
 *       serverArgs: [
 *         ...xpackFunctionalConfig.get('kbnTestServer.serverArgs'),
 *         `--xpack.actions.preconfigured=${JSON.stringify(preconfiguredConnectors)}`,
 *       ],
 *     },
 *   };
 * }
 * ```
 */
export const getPreconfiguredConnectorConfig = () => {
  return loadConnectors();
};

export const getAvailableConnectors = (): AvailableConnectorWithId[] => {
  return Object.entries(loadConnectors()).map(([id, connector]) => {
    return {
      id,
      ...connector,
    };
  });
};
