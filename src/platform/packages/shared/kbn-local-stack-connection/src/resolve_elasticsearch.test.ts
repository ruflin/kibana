/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import Fs from 'fs';
import Os from 'os';
import Path from 'path';
import { ToolingLog } from '@kbn/tooling-log';
import { SERVERLESS_SUPERUSER, STATEFUL_SUPERUSER } from './constants';
import { resolveElasticsearch } from './resolve_elasticsearch';
import type { TestServer } from './test_helpers';
import { esRootHandler, startTestServer } from './test_helpers';

const log = new ToolingLog();
const missingKibanaConfig = Path.join(Os.tmpdir(), 'kbn-local-stack-connection-missing.yml');

describe('resolveElasticsearch', () => {
  let servers: TestServer[] = [];
  const start = async (...args: Parameters<typeof startTestServer>) => {
    const server = await startTestServer(...args);
    servers.push(server);
    return server;
  };

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers = [];
  });

  it('connects to a stateful stack over http as elastic', async () => {
    const { port } = await start({
      validAuths: [STATEFUL_SUPERUSER],
      handler: esRootHandler('default'),
    });

    const connection = await resolveElasticsearch({
      log,
      url: `http://localhost:${port}`,
      env: {},
    });

    expect(connection).toMatchObject({
      url: `http://localhost:${port}`,
      auth: STATEFUL_SUPERUSER,
      flavor: 'stateful',
      tls: undefined,
    });
  });

  it('switches to https and elastic_serverless for a serverless stack', async () => {
    const { port } = await start({
      https: true,
      validAuths: [SERVERLESS_SUPERUSER],
      handler: esRootHandler('serverless'),
    });

    const connection = await resolveElasticsearch({
      log,
      url: `http://localhost:${port}`,
      env: {},
    });

    expect(connection).toMatchObject({
      url: `https://localhost:${port}`,
      auth: SERVERLESS_SUPERUSER,
      flavor: 'serverless',
      tls: { servername: 'localhost' },
    });
  });

  it('verifies the dev certificate when connecting via 127.0.0.1', async () => {
    const { port } = await start({
      https: true,
      validAuths: [SERVERLESS_SUPERUSER],
      handler: esRootHandler('serverless'),
    });

    await expect(
      resolveElasticsearch({ log, url: `https://127.0.0.1:${port}`, env: {} })
    ).resolves.toMatchObject({ url: `https://127.0.0.1:${port}`, flavor: 'serverless' });
  });

  it('uses credentials from the URL and does not fall back to default users', async () => {
    const { port } = await start({
      validAuths: [STATEFUL_SUPERUSER],
      handler: esRootHandler('default'),
    });

    await expect(
      resolveElasticsearch({ log, url: `http://someone:secret@localhost:${port}`, env: {} })
    ).rejects.toThrow(/user "someone": HTTP 401 \(invalid credentials\)/);
  });

  it('reads ELASTICSEARCH_* env vars', async () => {
    const custom = { username: 'custom', password: 'pw' };
    const { port } = await start({ validAuths: [custom], handler: esRootHandler('default') });

    const connection = await resolveElasticsearch({
      log,
      env: {
        ELASTICSEARCH_HOST: `localhost:${port}`,
        ELASTICSEARCH_USERNAME: custom.username,
        ELASTICSEARCH_PASSWORD: custom.password,
      },
    });

    expect(connection).toMatchObject({ url: `http://localhost:${port}`, auth: custom });
  });

  it('prefers explicit options over env vars', async () => {
    const { port } = await start({
      validAuths: [STATEFUL_SUPERUSER],
      handler: esRootHandler('default'),
    });

    const connection = await resolveElasticsearch({
      log,
      url: `http://localhost:${port}`,
      env: { ELASTICSEARCH_HOST: 'http://localhost:1', ELASTICSEARCH_USERNAME: 'nobody' },
      username: STATEFUL_SUPERUSER.username,
    });

    expect(connection.auth).toEqual(STATEFUL_SUPERUSER);
  });

  it('supports API keys', async () => {
    const { port } = await start({
      validAuths: [{ apiKey: 'my-key' }],
      handler: esRootHandler('default'),
    });

    const connection = await resolveElasticsearch({
      log,
      url: `http://localhost:${port}`,
      apiKey: 'my-key',
      env: {},
    });

    expect(connection.auth).toEqual({ apiKey: 'my-key' });
  });

  it('uses the host from kibana.dev.yml and ignores kibana_system credentials', async () => {
    const { port } = await start({
      https: true,
      validAuths: [SERVERLESS_SUPERUSER],
      handler: esRootHandler('serverless'),
    });
    const configPath = Path.join(Os.tmpdir(), `kbn-local-stack-connection-${port}.yml`);
    Fs.writeFileSync(
      configPath,
      [
        `elasticsearch.hosts: localhost:${port}`,
        'elasticsearch.username: kibana_system',
        'elasticsearch.password: changeme',
      ].join('\n')
    );

    try {
      const connection = await resolveElasticsearch({
        log,
        kibanaConfigPath: configPath,
        env: {},
      });
      expect(connection).toMatchObject({
        url: `https://localhost:${port}`,
        auth: SERVERLESS_SUPERUSER,
      });
    } finally {
      Fs.rmSync(configPath);
    }
  });

  it('does not fall back to localhost when kibana.dev.yml points to a remote cluster', async () => {
    const configPath = Path.join(Os.tmpdir(), 'kbn-local-stack-connection-remote.yml');
    Fs.writeFileSync(configPath, 'elasticsearch.hosts: ["https://cluster.example.invalid:9243"]');

    try {
      const error = await resolveElasticsearch({
        log,
        kibanaConfigPath: configPath,
        env: {},
      }).catch((e: Error) => e);
      expect(String(error)).toContain('https://cluster.example.invalid:9243');
      expect(String(error)).not.toContain('localhost');
    } finally {
      Fs.rmSync(configPath);
    }
  });

  it('reports every attempt when nothing is reachable', async () => {
    const { port } = await start({ validAuths: [], handler: esRootHandler('default') });
    await servers.pop()?.close();

    await expect(
      resolveElasticsearch({
        log,
        url: `http://localhost:${port}`,
        kibanaConfigPath: missingKibanaConfig,
        env: {},
      })
    ).rejects.toThrow(new RegExp(`http://localhost:${port}: [\\s\\S]*https://localhost:${port}: `));
  });
});
