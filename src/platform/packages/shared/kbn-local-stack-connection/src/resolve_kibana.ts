/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ConnectionOptions } from 'tls';
import { isEqual, uniq, uniqWith } from 'lodash';
import { createFailError } from '@kbn/dev-cli-errors';
import type { ToolingLog } from '@kbn/tooling-log';
import type { BasicAuth, ConnectionAuth } from './auth';
import { describeAuth } from './auth';
import { LOCAL_KIBANA_PORT, LOCAL_SUPERUSERS, STATEFUL_SUPERUSER } from './constants';
import type { KibanaDevConfig } from './kibana_dev_config';
import { readKibanaDevConfig } from './kibana_dev_config';
import type { ProbeResult } from './probe';
import { probe } from './probe';
import type { TlsPolicyOptions } from './tls';
import { getTlsOptions } from './tls';
import { getUrlCredentials, isLocalUrl, parseUrl, toBaseUrl, withSwitchedProtocol } from './url';

/** Headers Kibana requires for API calls made by scripts. */
export const KIBANA_REQUEST_HEADERS: Readonly<Record<string, string>> = {
  'kbn-xsrf': 'true',
  'x-elastic-internal-origin': 'Kibana',
};

export interface KibanaConnection {
  /** Base URL including the base path, without credentials or trailing slash. */
  url: string;
  auth: ConnectionAuth;
  tls?: ConnectionOptions;
  insecure: boolean;
}

export interface ResolveKibanaOptions extends TlsPolicyOptions {
  log: ToolingLog;
  /** Explicit URL, may contain `user:pass@` and a base path. Falls back to `KIBANA_URL`. */
  url?: string;
  /** Falls back to `KIBANA_USERNAME`. */
  username?: string;
  /** Falls back to `KIBANA_PASSWORD`. */
  password?: string;
  /** Falls back to `KIBANA_API_KEY`. */
  apiKey?: string;
  /** Credentials to try before the default superusers, e.g. from the Elasticsearch connection. */
  preferredAuth?: ConnectionAuth;
  /** Kibana config used for the default URL, defaults to `config/kibana.dev.yml`. */
  kibanaConfigPath?: string;
  env?: NodeJS.ProcessEnv;
}

interface KibanaCandidate {
  origin: string;
  basePaths: string[];
}

const normalizeBasePath = (path: string | undefined): string =>
  path ? `/${path.replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '') : '';

const LOCAL_DEFAULT_ORIGINS = [
  `http://localhost:${LOCAL_KIBANA_PORT}`,
  `https://localhost:${LOCAL_KIBANA_PORT}`,
] as const;

const getOriginsWithFallback = (origin: string): string[] =>
  isLocalUrl(origin) ? [origin, withSwitchedProtocol(origin)] : [origin];

const getCandidates = (
  explicitUrl: URL | undefined,
  config?: KibanaDevConfig
): KibanaCandidate[] => {
  if (explicitUrl) {
    const basePath = normalizeBasePath(explicitUrl.pathname);
    return getOriginsWithFallback(toBaseUrl(new URL(explicitUrl.origin))).map((origin) => ({
      origin,
      basePaths: [basePath],
    }));
  }

  const { host, port, basePath, sslEnabled } = config?.server ?? { sslEnabled: false };
  const configuredOrigin = toBaseUrl(
    new URL(
      `${sslEnabled ? 'https' : 'http'}://${!host || host === '0.0.0.0' ? 'localhost' : host}:${
        port ?? LOCAL_KIBANA_PORT
      }`
    )
  );
  const basePaths = basePath ? [normalizeBasePath(basePath)] : [];
  return uniq([...getOriginsWithFallback(configuredOrigin), ...LOCAL_DEFAULT_ORIGINS]).map(
    (origin) => ({ origin, basePaths })
  );
};

const isKibanaStatusResponse = (result: ProbeResult): boolean =>
  result.kind === 'ok' ||
  result.kind === 'unauthorized' ||
  (result.kind === 'unexpected_status' && result.status === 503);

/** Strips the paths Kibana appends when redirecting from `/`, keeping only the base path. */
const getBasePathFromRedirect = (origin: string, location: string): string =>
  normalizeBasePath(
    new URL(location, origin).pathname.replace(
      /\/(spaces\/enter|spaces\/space_selector|app\/.*|login.*)$/,
      ''
    )
  );

type BaseUrlResult = { kind: 'found'; url: string } | { kind: 'not_found'; reason: string };

/**
 * Finds the base path Kibana is served under. The dev base path proxy of `node scripts/kibana
 * --dev` answers `/` with a redirect to a random base path, and returns 404 for other paths.
 */
const findKibanaBaseUrl = async (
  { origin, basePaths }: KibanaCandidate,
  insecure: boolean
): Promise<BaseUrlResult> => {
  const tried = new Set<string>();
  const tryBasePath = async (basePath: string): Promise<ProbeResult> => {
    tried.add(basePath);
    return probe({
      url: `${origin}${basePath}/api/status`,
      headers: KIBANA_REQUEST_HEADERS,
      insecure,
    });
  };

  for (const basePath of uniq([...basePaths, ''])) {
    const result = await tryBasePath(basePath);
    if (result.kind === 'unreachable') {
      return { kind: 'not_found', reason: result.reason };
    }
    if (isKibanaStatusResponse(result)) {
      return { kind: 'found', url: `${origin}${basePath}` };
    }
  }

  const root = await probe({ url: `${origin}/`, insecure });
  if (root.kind === 'redirect') {
    const basePath = getBasePathFromRedirect(origin, root.location);
    if (!tried.has(basePath) && isKibanaStatusResponse(await tryBasePath(basePath))) {
      return { kind: 'found', url: `${origin}${basePath}` };
    }
  }

  return {
    kind: 'not_found',
    reason: `no Kibana status API found (tried base paths: ${[...tried]
      .map((path) => path || '/')
      .join(', ')})`,
  };
};

const getCandidateAuths = ({
  apiKey,
  username,
  password,
  preferredAuth,
}: {
  apiKey?: string;
  username?: string;
  password?: string;
  preferredAuth?: ConnectionAuth;
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
  return uniqWith(
    preferredAuth ? [preferredAuth, ...LOCAL_SUPERUSERS] : [...LOCAL_SUPERUSERS],
    isEqual
  );
};

/** Parses the legacy `KIBANA_AUTH=user:pass` env var used by `scripts/kibana_api_common.sh`. */
const parseLegacyAuth = (value: string | undefined): Partial<BasicAuth> => {
  if (!value) {
    return {};
  }
  const separator = value.indexOf(':');
  return separator === -1
    ? { username: value }
    : { username: value.slice(0, separator), password: value.slice(separator + 1) };
};

/**
 * Finds a working Kibana URL (including the dev base path) and credentials for scripts.
 *
 * Precedence: explicit options, then `KIBANA_*` env vars, then `server.*` from
 * `kibana.dev.yml`, then `localhost:5601`. Local URLs are tried over both http and https, with
 * `preferredAuth` and then the stateful and serverless superusers unless credentials are given.
 */
export const resolveKibana = async ({
  log,
  env = process.env,
  insecure = false,
  kibanaConfigPath,
  preferredAuth,
  ...options
}: ResolveKibanaOptions): Promise<KibanaConnection> => {
  const rawUrl = options.url ?? env.KIBANA_URL;
  const explicitUrl = rawUrl ? parseUrl(rawUrl) : undefined;
  const urlCredentials = explicitUrl ? getUrlCredentials(explicitUrl) : undefined;
  const legacyAuth = parseLegacyAuth(env.KIBANA_AUTH);
  const candidates = getCandidates(
    explicitUrl,
    explicitUrl ? undefined : readKibanaDevConfig(kibanaConfigPath)
  );
  const auths = getCandidateAuths({
    apiKey: options.apiKey ?? env.KIBANA_API_KEY,
    username:
      options.username ?? urlCredentials?.username ?? env.KIBANA_USERNAME ?? legacyAuth.username,
    password:
      options.password ?? urlCredentials?.password ?? env.KIBANA_PASSWORD ?? legacyAuth.password,
    preferredAuth,
  });

  const attempts: string[] = [];
  for (const candidate of candidates) {
    log.debug(`Probing Kibana at ${candidate.origin}`);
    const baseUrl = await findKibanaBaseUrl(candidate, insecure);
    if (baseUrl.kind === 'not_found') {
      attempts.push(`${candidate.origin}: ${baseUrl.reason}`);
      continue;
    }

    for (const auth of auths) {
      const result = await probe({
        url: `${baseUrl.url}/internal/security/me`,
        auth,
        headers: KIBANA_REQUEST_HEADERS,
        insecure,
      });
      // 404 means the security plugin is disabled, so any credentials are accepted.
      if (result.kind === 'ok' || (result.kind === 'unexpected_status' && result.status === 404)) {
        log.info(`Connected to Kibana at ${baseUrl.url} as ${describeAuth(auth)}`);
        return { url: baseUrl.url, auth, tls: getTlsOptions(baseUrl.url, { insecure }), insecure };
      }
      attempts.push(
        `${baseUrl.url} as ${describeAuth(auth)}: ${
          result.kind === 'unreachable' ? result.reason : `HTTP ${result.status}`
        }`
      );
    }
  }

  throw createFailError(
    [
      'Could not connect to Kibana. Tried:',
      ...attempts.map((attempt) => `  - ${attempt}`),
      '',
      'Start Kibana with `node scripts/kibana --dev [--serverless=<type>]`, or pass --kibana-url /',
      '--kibana-username / --kibana-password (or KIBANA_URL / KIBANA_USERNAME / KIBANA_PASSWORD /',
      'KIBANA_API_KEY).',
    ].join('\n')
  );
};
