/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { ToolingLog } from '@kbn/tooling-log';
import type { ConnectionAuth } from './auth';
import { SERVERLESS_SUPERUSER, STATEFUL_SUPERUSER } from './constants';
import { kibanaFetch } from './kibana_fetch';
import { resolveKibana } from './resolve_kibana';
import type { TestRequestHandler, TestServer } from './test_helpers';
import { startTestServer } from './test_helpers';

const log = new ToolingLog();

/** Emulates Kibana, optionally behind the dev base path proxy. */
const kibanaHandler =
  ({ basePath = '', proxy = false }: { basePath?: string; proxy?: boolean }): TestRequestHandler =>
  (req, res, { isAuthorized }) => {
    const path = req.url ?? '/';
    if (proxy && path === '/') {
      res.writeHead(302, { location: basePath }).end();
      return;
    }
    if (path === `${basePath}/api/status`) {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":{}}');
      return;
    }
    if (path === `${basePath}/internal/security/me`) {
      res.writeHead(isAuthorized ? 200 : 401).end(JSON.stringify({ headers: req.headers }));
      return;
    }
    if (path === `${basePath}/api/echo`) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(req.headers));
      return;
    }
    res.writeHead(404).end();
  };

describe('resolveKibana', () => {
  let servers: TestServer[] = [];
  const start = async (
    validAuths: ConnectionAuth[],
    handler: TestRequestHandler,
    https = false
  ) => {
    const server = await startTestServer({ validAuths, handler, https });
    servers.push(server);
    return server;
  };

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers = [];
  });

  it('connects to Kibana without a base path', async () => {
    const { port } = await start([STATEFUL_SUPERUSER], kibanaHandler({}));

    await expect(
      resolveKibana({ log, url: `http://localhost:${port}`, env: {} })
    ).resolves.toMatchObject({ url: `http://localhost:${port}`, auth: STATEFUL_SUPERUSER });
  });

  it('detects the base path of the dev base path proxy', async () => {
    const { port } = await start(
      [SERVERLESS_SUPERUSER],
      kibanaHandler({ basePath: '/xyz', proxy: true })
    );

    await expect(
      resolveKibana({ log, url: `http://localhost:${port}`, env: {} })
    ).resolves.toMatchObject({ url: `http://localhost:${port}/xyz`, auth: SERVERLESS_SUPERUSER });
  });

  it('uses the base path from the URL', async () => {
    const { port } = await start([STATEFUL_SUPERUSER], kibanaHandler({ basePath: '/kbn' }));

    await expect(
      resolveKibana({ log, url: `http://localhost:${port}/kbn/`, env: {} })
    ).resolves.toMatchObject({ url: `http://localhost:${port}/kbn` });
  });

  it('switches to https for Kibana started with --ssl', async () => {
    const { port } = await start([STATEFUL_SUPERUSER], kibanaHandler({}), true);

    await expect(
      resolveKibana({ log, url: `http://localhost:${port}`, env: {} })
    ).resolves.toMatchObject({
      url: `https://localhost:${port}`,
      tls: { servername: 'localhost' },
    });
  });

  it('tries preferredAuth first', async () => {
    const custom = { username: 'custom', password: 'pw' };
    const { port } = await start([custom, STATEFUL_SUPERUSER], kibanaHandler({}));

    await expect(
      resolveKibana({ log, url: `http://localhost:${port}`, preferredAuth: custom, env: {} })
    ).resolves.toMatchObject({ auth: custom });
  });

  it('reads KIBANA_URL and the legacy KIBANA_AUTH env vars', async () => {
    const custom = { username: 'custom', password: 'p:w' };
    const { port } = await start([custom], kibanaHandler({}));

    await expect(
      resolveKibana({
        log,
        env: { KIBANA_URL: `localhost:${port}`, KIBANA_AUTH: 'custom:p:w' },
      })
    ).resolves.toMatchObject({ url: `http://localhost:${port}`, auth: custom });
  });

  it('lists every attempt when authentication fails', async () => {
    const { port } = await start([], kibanaHandler({}));

    await expect(resolveKibana({ log, url: `http://localhost:${port}`, env: {} })).rejects.toThrow(
      /user "elastic": HTTP 401[\s\S]*user "elastic_serverless": HTTP 401/
    );
  });
});

describe('kibanaFetch', () => {
  it('sends auth and the required Kibana headers', async () => {
    const server = await startTestServer({
      validAuths: [STATEFUL_SUPERUSER],
      handler: kibanaHandler({ basePath: '/abc' }),
    });
    try {
      const connection = await resolveKibana({
        log,
        url: `http://localhost:${server.port}/abc`,
        env: {},
      });
      const response = await kibanaFetch(connection, 'api/echo', { method: 'GET' });
      expect(await response.json()).toMatchObject({
        'kbn-xsrf': 'true',
        'x-elastic-internal-origin': 'Kibana',
        authorization: `Basic ${Buffer.from('elastic:changeme').toString('base64')}`,
      });
    } finally {
      await server.close();
    }
  });
});
