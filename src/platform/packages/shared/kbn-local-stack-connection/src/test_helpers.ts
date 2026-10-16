/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import Fs from 'fs';
import Http from 'http';
import Https from 'https';
import type { AddressInfo } from 'net';
import { ES_CERT_PATH, ES_KEY_PATH } from '@kbn/dev-utils';
import type { ConnectionAuth } from './auth';
import { getAuthorizationHeader } from './auth';

export type TestRequestHandler = (
  req: Http.IncomingMessage,
  res: Http.ServerResponse,
  context: { isAuthorized: boolean }
) => void;

export interface TestServer {
  port: number;
  close: () => Promise<void>;
}

/** Starts an http(s) server on a random port. https uses the dev Elasticsearch certificate. */
export const startTestServer = async ({
  https = false,
  validAuths,
  handler,
}: {
  https?: boolean;
  validAuths: ConnectionAuth[];
  handler: TestRequestHandler;
}): Promise<TestServer> => {
  const validHeaders = new Set(validAuths.map(getAuthorizationHeader));
  const listener: Http.RequestListener = (req, res) =>
    handler(req, res, { isAuthorized: validHeaders.has(req.headers.authorization ?? '') });

  const server = https
    ? Https.createServer(
        { key: Fs.readFileSync(ES_KEY_PATH), cert: Fs.readFileSync(ES_CERT_PATH) },
        listener
      )
    : Http.createServer(listener);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

/** Handler that behaves like `GET /` of Elasticsearch. */
export const esRootHandler =
  (flavor: 'default' | 'serverless'): TestRequestHandler =>
  (req, res, { isAuthorized }) => {
    res.setHeader('content-type', 'application/json');
    if (!isAuthorized) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    res.end(JSON.stringify({ version: { build_flavor: flavor } }));
  };
