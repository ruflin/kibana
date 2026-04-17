/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ToolingLog } from '@kbn/tooling-log';
import http from 'http';
import https from 'https';
import fs from 'fs';
import os from 'os';
import path from 'path';
import execa from 'execa';
import chalk from 'chalk';

interface ElasticsearchCredentials {
  username: string;
  password: string;
}

interface ElasticsearchConnection {
  baseUrl: string;
  credentials: ElasticsearchCredentials;
  ssl: boolean;
}

interface CachedEisApiKey {
  key: string;
  fetched_at_ms: number;
  vault_addr: string;
}

const EIS_QA_URL = 'https://inference.eu-west-1.aws.svc.qa.elastic.cloud';
const EIS_URL_FLAG = `-E xpack.inference.elastic.url=${EIS_QA_URL}`;

const EIS_KEY_CACHE_PATH = path.join(os.homedir(), '.elastic', 'eis-ccm-key.json');
// Keys from vault are long-lived; re-fetch weekly so we don't require a browser
// login on every run but still refresh often enough to pick up rotations.
const EIS_KEY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const createBasicAuthHeader = (credentials: ElasticsearchCredentials): string =>
  Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');

function httpRequest(
  url: string,
  options: http.RequestOptions | https.RequestOptions,
  body?: string,
  ssl: boolean = true
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const requestFn = ssl ? https.request : http.request;
    const req = requestFn(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve({ statusCode: res.statusCode || 0, data });
      });
    });

    req.on('error', reject);

    if (typeof options.timeout === 'number') {
      req.on('timeout', () => {
        req.destroy(new Error(`Request to ${url} timed out after ${options.timeout}ms`));
      });
    }

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

async function testCredentials(
  baseUrl: string,
  credentials: ElasticsearchCredentials,
  ssl: boolean,
  log: ToolingLog
): Promise<boolean> {
  try {
    const { statusCode } = await httpRequest(
      baseUrl,
      {
        method: 'GET',
        headers: {
          Authorization: `Basic ${createBasicAuthHeader(credentials)}`,
        },
        rejectUnauthorized: false,
      },
      undefined,
      ssl
    );

    return statusCode === 200;
  } catch (error) {
    if (error.code === 'EPROTO') {
      log.debug('Protocol mismatch detected — attempting to connect with HTTP');
      throw new Error('Protocol mismatch error');
    }

    throw new Error('Failed to connect to Elasticsearch', { cause: error });
  }
}

async function getES(log: ToolingLog) {
  const rawHost = process.env.ES_HOST || 'localhost';
  const port = process.env.ES_PORT || '9200';

  const protocolMatch = rawHost.match(/^(https?):\/\/(.+)$/);
  const protocols = protocolMatch ? [protocolMatch[1]] : ['https', 'http'];
  const hostname = protocolMatch ? protocolMatch[2] : rawHost;
  const esAddress = `${hostname}:${port}`;

  const envUsername = process.env.ES_USERNAME || process.env.ELASTICSEARCH_USERNAME;
  const envPassword = process.env.ES_PASSWORD || process.env.ELASTICSEARCH_PASSWORD;

  const credentialsToTry: {
    username: string;
    password: string;
    type: string;
  }[] = [];

  if (envUsername && envPassword) {
    credentialsToTry.push({
      username: envUsername,
      password: envPassword,
      type: 'environment variable',
    });
  }

  credentialsToTry.push(
    { username: 'elastic', password: 'changeme', type: 'default' },
    { username: 'elastic_serverless', password: 'changeme', type: 'default' }
  );

  for (const protocol of protocols) {
    const baseUrl = `${protocol}://${esAddress}`;

    for (const credentials of credentialsToTry) {
      const isSsl = protocol === 'https';
      try {
        log.debug(`Trying ${credentials.type} credentials: ${credentials.username}`);

        const isValid = await testCredentials(baseUrl, credentials, isSsl, log);

        if (isValid) {
          log.info(
            `Connected to Elasticsearch at ${chalk.cyan(baseUrl)} (${
              credentials.type
            } credentials: ${credentials.username})`
          );

          return {
            baseUrl,
            credentials,
            ssl: isSsl,
          };
        }
      } catch (error) {
        if (error.message === 'Protocol mismatch error') {
          break; // stop trying creds, move to next protocol
        }
      }
    }
  }

  throw new Error(
    [
      `Could not connect to Elasticsearch at ${esAddress}.`,
      '',
      `Make sure Elasticsearch is running with the EIS URL flag:`,
      '',
      `  ${chalk.cyan(EIS_URL_FLAG)}`,
      '',
      'If using custom credentials, set ES_USERNAME and ES_PASSWORD environment variables.',
    ].join('\n')
  );
}

function readCachedEisApiKey(vaultAddress: string, log: ToolingLog): string | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(EIS_KEY_CACHE_PATH, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      log.debug(`Could not read cached EIS key at ${EIS_KEY_CACHE_PATH}: ${error.message}`);
    }
    return undefined;
  }

  let cached: CachedEisApiKey;
  try {
    cached = JSON.parse(raw) as CachedEisApiKey;
  } catch (error) {
    log.debug(`Cached EIS key at ${EIS_KEY_CACHE_PATH} is not valid JSON, ignoring`);
    return undefined;
  }

  if (!cached.key || typeof cached.key !== 'string') {
    return undefined;
  }

  if (cached.vault_addr !== vaultAddress) {
    log.debug(
      `Cached EIS key was fetched from a different vault (${cached.vault_addr}), ignoring`
    );
    return undefined;
  }

  const ageMs = Date.now() - (cached.fetched_at_ms ?? 0);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > EIS_KEY_CACHE_TTL_MS) {
    log.debug(
      `Cached EIS key at ${EIS_KEY_CACHE_PATH} is stale (age ${Math.round(
        ageMs / (60 * 60 * 1000)
      )}h), refreshing`
    );
    return undefined;
  }

  return cached.key;
}

function writeCachedEisApiKey(apiKey: string, vaultAddress: string, log: ToolingLog): void {
  const payload: CachedEisApiKey = {
    key: apiKey,
    fetched_at_ms: Date.now(),
    vault_addr: vaultAddress,
  };

  try {
    fs.mkdirSync(path.dirname(EIS_KEY_CACHE_PATH), { recursive: true });
    fs.writeFileSync(EIS_KEY_CACHE_PATH, JSON.stringify(payload, null, 2), { mode: 0o600 });
    log.debug(`Cached EIS API key to ${EIS_KEY_CACHE_PATH}`);
  } catch (error) {
    log.warning(`Failed to cache EIS API key at ${EIS_KEY_CACHE_PATH}: ${error.message}`);
  }
}

async function isEisApiKeyValid(apiKey: string, log: ToolingLog): Promise<boolean> {
  // Probe the EIS root with the candidate key. EIS (like most API gateways)
  // validates auth before routing, so a 401/403 is a definitive "key rejected"
  // signal even if the root path itself returns 404/405 on success. Network
  // errors are treated as "valid" so a transient EIS outage doesn't force a
  // browser-based vault login.
  try {
    const { statusCode } = await httpRequest(
      EIS_QA_URL,
      {
        method: 'GET',
        headers: {
          Authorization: `ApiKey ${apiKey}`,
        },
        timeout: 5000,
      },
      undefined,
      true
    );

    if (statusCode === 401 || statusCode === 403) {
      log.debug(`EIS rejected cached API key (HTTP ${statusCode}), refreshing from vault`);
      return false;
    }

    log.debug(`EIS accepted cached API key (HTTP ${statusCode})`);
    return true;
  } catch (error) {
    log.debug(
      `Could not reach EIS to validate cached API key, assuming valid: ${error.message}`
    );
    return true;
  }
}

async function getEisApiKeyFromVault(vaultAddress: string): Promise<string> {
  const secretPath = 'secret/kibana-issues/dev/inference/kibana-eis-ccm';

  let stdout: string;
  let stderr: string;
  try {
    ({ stdout, stderr } = await execa('vault', ['read', '-field', 'key', secretPath], {
      env: { VAULT_ADDR: vaultAddress },
    }));
  } catch (error) {
    const vaultStderr = error.stderr?.trim();
    const parts = [
      'Failed to read EIS API key from vault.',
      ...(vaultStderr ? [`Vault output: ${vaultStderr}`] : []),
      '',
      'Make sure you are logged in:',
      '',
      `  ${chalk.cyan(`VAULT_ADDR=${vaultAddress} vault login --method oidc`)}`,
      '',
      'See https://docs.elastic.dev/vault for setup instructions.',
    ];
    throw new Error(parts.join('\n'), { cause: error });
  }

  const apiKey = stdout.trim();
  if (!apiKey) {
    const parts = ['Vault returned an empty API key.'];
    const vaultOutput = stderr.trim();
    if (vaultOutput) {
      parts.push(`Vault output: ${vaultOutput}`);
    }
    throw new Error(parts.join(' '));
  }

  return apiKey;
}

async function getEisEndpoint(
  es: ElasticsearchConnection,
  log: ToolingLog
): Promise<string | undefined> {
  try {
    const { statusCode, data } = await httpRequest(
      `${es.baseUrl}/_cluster/settings?include_defaults=true&flat_settings=true`,
      {
        method: 'GET',
        headers: { Authorization: `Basic ${createBasicAuthHeader(es.credentials)}` },
        rejectUnauthorized: false,
      },
      undefined,
      es.ssl
    );

    if (statusCode !== 200) {
      log.warning(`Failed to get cluster settings: HTTP ${statusCode}`);
      return undefined;
    }

    const settings = JSON.parse(data);
    return (
      settings.persistent?.['xpack.inference.elastic.url'] ||
      settings.transient?.['xpack.inference.elastic.url'] ||
      settings.defaults?.['xpack.inference.elastic.url'] ||
      undefined
    );
  } catch (error) {
    log.warning(`Error fetching cluster settings: ${error.message}`);
    return undefined;
  }
}

async function setCcmApiKey(
  apiKey: string,
  es: ElasticsearchConnection,
  log: ToolingLog
): Promise<void> {
  log.debug('Setting CCM API key in Elasticsearch');

  const maxRetries = 3;
  const retryDelayMs = 2000;
  const esUrl = `${es.baseUrl}/_inference/_ccm`;
  const auth = createBasicAuthHeader(es.credentials);
  const body = JSON.stringify({ api_key: apiKey });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { statusCode } = await httpRequest(
        esUrl,
        {
          method: 'PUT',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          rejectUnauthorized: false,
        },
        body,
        es.ssl
      );

      if (statusCode >= 200 && statusCode < 300) {
        log.debug('Successfully set CCM API key');
        return;
      }

      if (statusCode === 401 || statusCode === 403) {
        throw new Error(
          [
            `HTTP ${statusCode} — Elasticsearch rejected the CCM request.`,
            '',
            'Make sure Elasticsearch was started with the EIS URL flag:',
            '',
            `  ${chalk.cyan(EIS_URL_FLAG)}`,
          ].join('\n')
        );
      }

      throw new Error(`HTTP ${statusCode}`);
    } catch (error) {
      if (
        attempt < maxRetries &&
        !(error instanceof Error && /HTTP (401|403)/.test(error.message))
      ) {
        log.debug(`Attempt ${attempt} failed, retrying in ${retryDelayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      } else {
        throw new Error(`Failed to set CCM API key.`, { cause: error });
      }
    }
  }
}

export async function ensureEis({ log }: { log: ToolingLog }) {
  log.info('Setting up Cloud Connected Mode for EIS');

  // Step 1: Connect to Elasticsearch and log what we're using
  const es = await getES(log);

  // Step 2: Check if the EIS endpoint is configured
  const eisEndpoint = await getEisEndpoint(es, log);
  if (eisEndpoint) {
    log.info(`EIS endpoint: ${chalk.cyan(eisEndpoint)}`);
  } else {
    log.warning(
      `Could not detect xpack.inference.elastic.url — make sure Elasticsearch was started with ${chalk.cyan(
        '-E xpack.inference.elastic.url=...'
      )}`
    );
  }

  // Step 3: Resolve the CCM API key
  const envApiKey = process.env.KIBANA_EIS_CCM_API_KEY?.trim();
  const forceRefresh = process.env.KIBANA_EIS_CCM_REFRESH === 'true';
  let apiKey: string;

  if (envApiKey) {
    log.info('Using CCM API key from KIBANA_EIS_CCM_API_KEY environment variable');
    apiKey = envApiKey;
  } else {
    const vaultAddress = process.env.VAULT_ADDR || 'https://secrets.elastic.co:8200';

    const cachedApiKey = forceRefresh ? undefined : readCachedEisApiKey(vaultAddress, log);
    const cachedApiKeyIsValid = cachedApiKey
      ? await isEisApiKeyValid(cachedApiKey, log)
      : false;

    if (cachedApiKey && cachedApiKeyIsValid) {
      log.info(`Using cached CCM API key from ${chalk.cyan(EIS_KEY_CACHE_PATH)}`);
      apiKey = cachedApiKey;
    } else {
      if (cachedApiKey && !cachedApiKeyIsValid) {
        log.info('Cached CCM API key was rejected by EIS, fetching a fresh one from vault...');
      } else {
        log.info('Fetching CCM API key from vault...');
      }
      apiKey = await getEisApiKeyFromVault(vaultAddress);
      writeCachedEisApiKey(apiKey, vaultAddress, log);
    }
  }

  // Step 4: Set the CCM API key in Elasticsearch
  await setCcmApiKey(apiKey, es, log);

  log.write('');
  log.write(`${chalk.green('✔')} EIS API key successfully set in Cloud Connected Mode`);
  log.write('');
}
