/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ConnectionOptions } from 'tls';
import { Client } from '@elastic/elasticsearch';
import type { BasicAuth, ConnectionAuth } from '@kbn/local-stack-connection';
import { isApiKeyAuth, resolveElasticsearch, resolveKibana } from '@kbn/local-stack-connection';
import type { ToolingLog } from '@kbn/tooling-log';

export interface EsConnectionConfig {
  esUrl: string;
  esTls?: ConnectionOptions;
  username: string;
  password: string;
}

export interface ConnectionConfig extends EsConnectionConfig {
  /** Kibana URL including the dev base path. */
  kibanaUrl: string;
  kibanaTls?: ConnectionOptions;
}

const getStringFlag = (flags: Record<string, unknown>, name: string): string | undefined =>
  flags[name] ? String(flags[name]) : undefined;

const toBasicAuth = (auth: ConnectionAuth): BasicAuth => {
  if (isApiKeyAuth(auth)) {
    throw new Error('API key auth is not supported by the sigevents snapshot scripts.');
  }
  return auth;
};

/**
 * Resolves Elasticsearch from `--es-url` / `--es-username` / `--es-password`, `ELASTICSEARCH_*`
 * env vars, `kibana.dev.yml`, or the local stateful or serverless defaults.
 */
export async function getEsConnectionConfig(
  flags: Record<string, unknown>,
  log: ToolingLog
): Promise<EsConnectionConfig> {
  const es = await resolveElasticsearch({
    log,
    url: getStringFlag(flags, 'es-url'),
    username: getStringFlag(flags, 'es-username'),
    password: getStringFlag(flags, 'es-password'),
  });
  return { esUrl: es.url, esTls: es.tls, ...toBasicAuth(es.auth) };
}

/** Resolves Elasticsearch and Kibana with the same credentials. */
export async function getConnectionConfig(
  flags: Record<string, unknown>,
  log: ToolingLog
): Promise<ConnectionConfig> {
  const esConfig = await getEsConnectionConfig(flags, log);
  const kibana = await resolveKibana({
    log,
    url: getStringFlag(flags, 'kibana-url'),
    username: esConfig.username,
    password: esConfig.password,
  });
  return { ...esConfig, kibanaUrl: kibana.url, kibanaTls: kibana.tls };
}

/** Elasticsearch client for the resolved connection, optionally as a different user. */
export function createEsClient(
  { esUrl, esTls, username, password }: EsConnectionConfig,
  auth: BasicAuth = { username, password }
): Client {
  return new Client({ node: esUrl, auth, tls: esTls });
}
