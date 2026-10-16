/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ConnectionOptions } from 'tls';
import { get, uniq } from 'lodash';
import type { ToolingLog } from '@kbn/tooling-log';
import type { ConnectionAuth } from './auth';
import { describeAuth } from './auth';
import { LOCAL_ES_PORT, LOCAL_SUPERUSERS, STATEFUL_SUPERUSER } from './constants';
import { getKibanaDevConfigCredentials, readKibanaDevConfig } from './kibana_dev_config';
import { probe } from './probe';
import type { TlsPolicyOptions } from './tls';
import { getTlsOptions } from './tls';
import { getUrlCredentials, isLocalUrl, parseUrl, toBaseUrl, withSwitchedProtocol } from './url';

export type ElasticsearchFlavor = 'stateful' | 'serverless';

export interface ElasticsearchConnection {
  /** Base URL without credentials or trailing slash. */
  url: string;
  auth: ConnectionAuth;
  /** TLS options for the Elasticsearch client, `https.request`, or undici. */
  tls?: ConnectionOptions;
  insecure: boolean;
  flavor: ElasticsearchFlavor;
}

export interface ResolveElasticsearchOptions extends TlsPolicyOptions {
  log: ToolingLog;
  /** Explicit URL, may contain `user:pass@`. Falls back to `ELASTICSEARCH_HOST`. */
  url?: string;
  /** Falls back to `ELASTICSEARCH_USERNAME`. */
  username?: string;
  /** Falls back to `ELASTICSEARCH_PASSWORD`. */
  password?: string;
  /** Falls back to `ELASTICSEARCH_API_KEY`. */
  apiKey?: string;
  /** Kibana config used for the default host, defaults to `config/kibana.dev.yml`. */
  kibanaConfigPath?: string;
  env?: NodeJS.ProcessEnv;
}

const LOCAL_DEFAULT_URLS = [
  `http://localhost:${LOCAL_ES_PORT}`,
  `https://localhost:${LOCAL_ES_PORT}`,
] as const;

const withLocalProtocolFallback = (baseUrl: string): string[] =>
  isLocalUrl(baseUrl) ? [baseUrl, withSwitchedProtocol(baseUrl)] : [baseUrl];

const getCandidateUrls = (
  explicitUrl: URL | undefined,
  kibanaConfigHost: string | undefined
): string[] => {
  if (explicitUrl) {
    return withLocalProtocolFallback(toBaseUrl(explicitUrl));
  }
  if (!kibanaConfigHost) {
    return [...LOCAL_DEFAULT_URLS];
  }
  const configured = toBaseUrl(parseUrl(kibanaConfigHost));
  // A remote cluster configured for Kibana is the intended target; never fall back to localhost.
  return isLocalUrl(configured)
    ? uniq([...withLocalProtocolFallback(configured), ...LOCAL_DEFAULT_URLS])
    : [configured];
};

const getCandidateAuths = ({
  apiKey,
  username,
  password,
  configCredentials,
}: {
  apiKey?: string;
  username?: string;
  password?: string;
  configCredentials?: ConnectionAuth;
}): ConnectionAuth[] => {
  if (apiKey) {
    return [{ apiKey }];
  }
  if (username) {
    return [{ username, password: password ?? STATEFUL_SUPERUSER.password }];
  }
  if (password) {
    return LOCAL_SUPERUSERS.map((user) => ({ username: user.username, password }));
  }
  return configCredentials ? [configCredentials, ...LOCAL_SUPERUSERS] : [...LOCAL_SUPERUSERS];
};

/**
 * Finds a working Elasticsearch URL and credentials for scripts.
 *
 * Precedence: explicit options, then `ELASTICSEARCH_*` env vars, then the host from
 * `kibana.dev.yml`, then `localhost:9200`. Local URLs are tried over both http and https, with
 * the stateful (`elastic`) and serverless (`elastic_serverless`) superusers unless credentials
 * are given.
 */
export const resolveElasticsearch = async ({
  log,
  env = process.env,
  insecure = false,
  kibanaConfigPath,
  ...options
}: ResolveElasticsearchOptions): Promise<ElasticsearchConnection> => {
  const rawUrl = options.url ?? env.ELASTICSEARCH_HOST;
  const explicitUrl = rawUrl ? parseUrl(rawUrl) : undefined;
  const urlCredentials = explicitUrl ? getUrlCredentials(explicitUrl) : undefined;
  const kibanaConfig = explicitUrl ? undefined : readKibanaDevConfig(kibanaConfigPath);

  const urls = getCandidateUrls(explicitUrl, kibanaConfig?.elasticsearch.hosts[0]);
  const auths = getCandidateAuths({
    apiKey: options.apiKey ?? env.ELASTICSEARCH_API_KEY,
    username: options.username ?? urlCredentials?.username ?? env.ELASTICSEARCH_USERNAME,
    password: options.password ?? urlCredentials?.password ?? env.ELASTICSEARCH_PASSWORD,
    configCredentials: kibanaConfig ? getKibanaDevConfigCredentials(kibanaConfig) : undefined,
  });

  const attempts: string[] = [];
  for (const url of urls) {
    for (const auth of auths) {
      log.debug(`Probing Elasticsearch at ${url} as ${describeAuth(auth)}`);
      const result = await probe({ url, auth, insecure });

      if (result.kind === 'ok') {
        const flavor: ElasticsearchFlavor =
          get(result.body, 'version.build_flavor') === 'serverless' ? 'serverless' : 'stateful';
        log.info(`Connected to Elasticsearch at ${url} as ${describeAuth(auth)} (${flavor})`);
        return { url, auth, tls: getTlsOptions(url, { insecure }), insecure, flavor };
      }

      if (result.kind === 'unreachable') {
        attempts.push(`${url}: ${result.reason}`);
        break;
      }

      attempts.push(
        `${url} as ${describeAuth(auth)}: HTTP ${result.status}${
          result.kind === 'unauthorized' ? ' (invalid credentials)' : ''
        }`
      );
    }
  }

  throw new Error(
    [
      'Could not connect to Elasticsearch. Tried:',
      ...attempts.map((attempt) => `  - ${attempt}`),
      '',
      'Start Elasticsearch with `node scripts/es snapshot` or `node scripts/es serverless`, or pass',
      '--es-url / --es-username / --es-password (or ELASTICSEARCH_HOST / ELASTICSEARCH_USERNAME /',
      'ELASTICSEARCH_PASSWORD / ELASTICSEARCH_API_KEY).',
    ].join('\n')
  );
};

/** Options for `new Client()` from `@elastic/elasticsearch`. */
export const getEsClientOptions = ({
  url,
  auth,
  tls,
}: ElasticsearchConnection): { node: string; auth: ConnectionAuth; tls?: ConnectionOptions } => ({
  node: url,
  auth,
  tls,
});
