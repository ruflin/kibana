/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import Fs from 'fs';
import Path from 'path';
import { get, isPlainObject, merge } from 'lodash';
import { set } from '@kbn/safer-lodash-set';
import { REPO_ROOT } from '@kbn/repo-info';
import { parse } from 'yaml';
import type { BasicAuth } from './auth';

export const DEFAULT_KIBANA_DEV_CONFIG_PATH = Path.resolve(REPO_ROOT, 'config/kibana.dev.yml');

export interface KibanaDevConfig {
  path: string;
  exists: boolean;
  elasticsearch: {
    hosts: string[];
    username?: string;
    password?: string;
  };
  server: {
    host?: string;
    port?: number;
    basePath?: string;
    sslEnabled: boolean;
  };
  /** The full config with dotted keys expanded, for script specific settings. */
  raw: Record<string, unknown>;
}

type PlainObject = Record<string, unknown>;

const isObject = (value: unknown): value is PlainObject => isPlainObject(value);

/** Expands dotted keys and deep-merges them with nested objects, independent of key order. */
const expandDottedKeys = (value: PlainObject): PlainObject => {
  const result: PlainObject = {};
  for (const [key, entry] of Object.entries(value)) {
    const expanded = isObject(entry) ? expandDottedKeys(entry) : entry;
    const existing: unknown = get(result, key);
    set(
      result,
      key,
      isObject(existing) && isObject(expanded) ? merge({}, existing, expanded) : expanded
    );
  }
  return result;
};

const toOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

/**
 * Reads `config/kibana.dev.yml` (or `configPath`). Dotted (`elasticsearch.hosts`) and nested
 * keys are both supported. A missing file yields an empty config.
 *
 * Note that `node scripts/kibana --dev --serverless` injects the Elasticsearch host, CA, and
 * service account at runtime, so this file never fully describes a serverless dev stack.
 */
export const readKibanaDevConfig = (configPath?: string): KibanaDevConfig => {
  const path = configPath ? Path.resolve(configPath) : DEFAULT_KIBANA_DEV_CONFIG_PATH;
  const exists = Fs.existsSync(path);
  const parsed: unknown = exists ? parse(Fs.readFileSync(path, 'utf8')) : undefined;
  const raw = isObject(parsed) ? expandDottedKeys(parsed) : {};

  const hosts: unknown = get(raw, 'elasticsearch.hosts');
  const port: unknown = get(raw, 'server.port');

  return {
    path,
    exists,
    elasticsearch: {
      hosts: (Array.isArray(hosts) ? hosts : [hosts]).flatMap(
        (host) => toOptionalString(host) ?? []
      ),
      username: toOptionalString(get(raw, 'elasticsearch.username')),
      password: toOptionalString(get(raw, 'elasticsearch.password')),
    },
    server: {
      host: toOptionalString(get(raw, 'server.host')),
      port: typeof port === 'number' ? port : Number(port) || undefined,
      basePath: toOptionalString(get(raw, 'server.basePath')),
      sslEnabled: get(raw, 'server.ssl.enabled') === true,
    },
    raw,
  };
};

/**
 * Elasticsearch credentials from the Kibana dev config that are usable by scripts. The
 * `kibana_system` user Kibana connects with lacks the privileges scripts need, so it is ignored.
 */
export const getKibanaDevConfigCredentials = (config: KibanaDevConfig): BasicAuth | undefined => {
  const { username, password } = config.elasticsearch;
  if (!username || !password || username.startsWith('kibana_system')) {
    return undefined;
  }
  return { username, password };
};
