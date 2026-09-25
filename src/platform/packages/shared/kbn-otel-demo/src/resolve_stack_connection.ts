/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ConnectionAuth, BasicAuth } from '@kbn/local-stack-connection';
import { isApiKeyAuth, resolveLocalStack } from '@kbn/local-stack-connection';
import type { ToolingLog } from '@kbn/tooling-log';
export interface ElasticsearchConfig {
  hosts: string;
  username: string;
  password: string;
}

export interface StackConnection {
  elasticsearch: ElasticsearchConfig;
  /** Kibana URL including the dev base path. */
  kibanaUrl: string;
  kibanaCredentials: BasicAuth;
}

const toBasicAuth = (auth: ConnectionAuth, service: string): BasicAuth => {
  if (isApiKeyAuth(auth)) {
    throw new Error(
      `API key auth for ${service} is not supported by the OTel demo, which passes basic auth to the collector.`
    );
  }
  return auth;
};

/** Legacy `KIBANA_HOST` / `KIBANA_PORT` env vars, superseded by `KIBANA_URL`. */
const getLegacyKibanaUrl = (env: NodeJS.ProcessEnv): string | undefined =>
  env.KIBANA_HOST || env.KIBANA_PORT
    ? `http://${env.KIBANA_HOST || 'localhost'}:${env.KIBANA_PORT || '5601'}`
    : undefined;

/**
 * Resolves Elasticsearch and Kibana for a local stateful or serverless stack, or the cluster
 * configured in the Kibana config file, via `@kbn/local-stack-connection`.
 */
export const resolveStackConnection = async (
  log: ToolingLog,
  configPath?: string
): Promise<StackConnection> => {
  const { elasticsearch, kibana } = await resolveLocalStack({
    log,
    elasticsearch: { kibanaConfigPath: configPath },
    kibana: {
      kibanaConfigPath: configPath,
      url: process.env.KIBANA_URL ?? getLegacyKibanaUrl(process.env),
    },
  });
  const esAuth = toBasicAuth(elasticsearch.auth, 'Elasticsearch');

  return {
    elasticsearch: { hosts: elasticsearch.url, ...esAuth },
    kibanaUrl: kibana.url,
    kibanaCredentials: toBasicAuth(kibana.auth, 'Kibana'),
  };
};
