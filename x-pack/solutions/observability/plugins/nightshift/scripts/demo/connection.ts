/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ToolingLog } from '@kbn/tooling-log';
import { fetch } from 'undici';
import { dispatcherFor, isLocalHttps } from './http';
import type { DemoAuth, DemoConnection } from './http';

/** Local stacks: serverless serves HTTPS with `elastic_serverless`, stateful serves HTTP with `elastic`. */
const ES_URLS = ['https://localhost:9200', 'http://localhost:9200'];
const KIBANA_URLS = ['https://localhost:5601', 'http://localhost:5601'];
const DEFAULT_AUTHS: DemoAuth[] = [
  { username: 'elastic_serverless', password: 'changeme' },
  { username: 'elastic', password: 'changeme' },
];

/** Connection flags from the command line; unset values are detected. */
export interface ConnectionFlags {
  esUrl?: string;
  kibanaUrl?: string;
  esUsername?: string;
  esPassword?: string;
  space?: string;
}

export interface ResolvedConnection {
  connection: DemoConnection;
  /** True when Elasticsearch is a local HTTPS endpoint, whose self-signed certificate is accepted. */
  insecureTls: boolean;
}

const authHeader = ({ username, password }: DemoAuth): string =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

/** HTTP status of a GET, or 0 when nothing answers at the URL. */
const probe = async (url: string, auth?: DemoAuth): Promise<number> => {
  try {
    const response = await fetch(url, {
      headers: auth ? { authorization: authHeader(auth) } : {},
      signal: AbortSignal.timeout(5_000),
      dispatcher: dispatcherFor(url),
    });
    return response.status;
  } catch {
    return 0;
  }
};

const findEs = async (
  candidates: string[],
  auths: DemoAuth[]
): Promise<{ url: string; auth: DemoAuth }> => {
  for (const url of candidates) {
    for (const auth of auths) {
      if ((await probe(`${url}/_security/_authenticate`, auth)) === 200) {
        return { url, auth };
      }
    }
  }
  throw new Error(
    `No Elasticsearch answered at ${candidates.join(' or ')} with ${auths
      .map(({ username }) => username)
      .join(' or ')}. Pass --es-url, --es-username and --es-password.`
  );
};

const findKibana = async (candidates: string[], auth: DemoAuth): Promise<string> => {
  for (const url of candidates) {
    if ((await probe(`${url}/api/status`)) === 0) {
      continue;
    }
    if ((await probe(`${url}/api/security/v1/me`, auth)) !== 401) {
      return url;
    }
  }
  throw new Error(
    `No Kibana answered at ${candidates.join(' or ')} for ${auth.username}. Pass --kibana-url.`
  );
};

/**
 * Finds the local Elasticsearch and Kibana, trying HTTPS before HTTP and both local users.
 * Explicit flags skip detection for that service.
 */
export const resolveConnection = async (
  flags: ConnectionFlags,
  log: ToolingLog
): Promise<ResolvedConnection> => {
  const explicitAuth: DemoAuth | undefined =
    flags.esUsername || flags.esPassword
      ? {
          username: flags.esUsername || 'elastic',
          password: flags.esPassword || 'changeme',
        }
      : undefined;
  const esCandidates = flags.esUrl ? [flags.esUrl] : ES_URLS;
  const kibanaCandidates = flags.kibanaUrl ? [flags.kibanaUrl] : KIBANA_URLS;

  const es = await findEs(esCandidates, explicitAuth ? [explicitAuth] : DEFAULT_AUTHS);
  const kibanaUrl = await findKibana(kibanaCandidates, es.auth);
  log.info(`Using Elasticsearch ${es.url} (${es.auth.username}) and Kibana ${kibanaUrl}`);

  return {
    connection: {
      esUrl: es.url,
      kibanaUrl,
      space: flags.space || 'default',
      auth: es.auth,
    },
    insecureTls: isLocalHttps(es.url),
  };
};
