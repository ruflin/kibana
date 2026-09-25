/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaConnection } from '@kbn/local-stack-connection';
import { kibanaFetch, resolveKibana } from '@kbn/local-stack-connection';
import { ToolingLog } from '@kbn/tooling-log';

let connection: Promise<KibanaConnection> | undefined;

/** Resolves the local stateful or serverless Kibana once, honoring `KIBANA_URL` and friends. */
const getConnection = (): Promise<KibanaConnection> => {
  connection ??= resolveKibana({ log: new ToolingLog({ level: 'info', writeTo: process.stdout }) });
  return connection;
};

/** POSTs `body` as JSON to a Kibana API and throws on non-2xx responses. */
export const kibanaPost = async <T = unknown>(
  path: string,
  body: unknown
): Promise<{ data: T }> => {
  const response = await kibanaFetch(await getConnection(), path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => undefined)) as T;
  if (!response.ok) {
    throw new Error(`POST ${path} failed with HTTP ${response.status}: ${JSON.stringify(data)}`);
  }
  return { data };
};
