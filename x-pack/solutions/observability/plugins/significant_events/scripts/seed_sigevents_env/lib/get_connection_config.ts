/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ConnectionOptions } from 'tls';
import { Agent } from 'undici';
import type { ConnectionAuth } from '@kbn/local-stack-connection';
import { isApiKeyAuth, resolveElasticsearch, resolveKibana } from '@kbn/local-stack-connection';
import type { ToolingLog } from '@kbn/tooling-log';

export interface ConnectionConfig {
  esUrl: string;
  kibanaUrl: string;
  username: string;
  password: string;
  esTls?: ConnectionOptions;
  kibanaTls?: ConnectionOptions;
}

const getStringFlag = (flags: Record<string, unknown>, name: string): string | undefined =>
  flags[name] ? String(flags[name]) : undefined;

const assertBasicAuth = (auth: ConnectionAuth) => {
  if (isApiKeyAuth(auth)) {
    throw new Error('API key auth is not supported by seed_sigevents_env.');
  }
  return auth;
};

/**
 * Resolves a superuser connection to Elasticsearch, and Kibana with the same user, for a local stateful or
 * serverless stack, or the cluster given by flags / `ELASTICSEARCH_*` / `KIBANA_URL`.
 */
export async function getConnectionConfig(
  flags: Record<string, unknown>,
  log: ToolingLog
): Promise<ConnectionConfig> {
  const elasticsearch = await resolveElasticsearch({
    log,
    url: getStringFlag(flags, 'es-url'),
    username: getStringFlag(flags, 'es-username'),
    password: getStringFlag(flags, 'es-password'),
  });
  const { username, password } = assertBasicAuth(elasticsearch.auth);
  const kibana = await resolveKibana({
    log,
    url: getStringFlag(flags, 'kibana-url'),
    username,
    password,
  });

  return {
    esUrl: elasticsearch.url,
    kibanaUrl: kibana.url,
    username,
    password,
    esTls: elasticsearch.tls,
    kibanaTls: kibana.tls,
  };
}

const dispatchers = new WeakMap<ConnectionConfig, Agent | undefined>();

/** undici dispatcher applying the Kibana TLS options of `config`. */
export function getKibanaDispatcher(config: ConnectionConfig): Agent | undefined {
  if (!dispatchers.has(config)) {
    dispatchers.set(
      config,
      config.kibanaTls ? new Agent({ connect: config.kibanaTls }) : undefined
    );
  }
  return dispatchers.get(config);
}
