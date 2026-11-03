/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { Agent, fetch } from 'undici';

export interface DemoAuth {
  username: string;
  password: string;
}

export interface DemoConnection {
  esUrl: string;
  kibanaUrl: string;
  space: string;
  auth: DemoAuth;
}

export interface HttpResult<T> {
  status: number;
  data: T;
}

/** Accepts the self-signed certificate of a local serverless stack, for localhost only. */
const LOCAL_HTTPS_AGENT = new Agent({ connect: { rejectUnauthorized: false } });

export const isLocalHttps = (url: string): boolean => {
  const { protocol, hostname } = new URL(url);
  return protocol === 'https:' && (hostname === 'localhost' || hostname === '127.0.0.1');
};

export const dispatcherFor = (url: string): Agent | undefined =>
  isLocalHttps(url) ? LOCAL_HTTPS_AGENT : undefined;

const authHeader = ({ username, password }: DemoAuth): string =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

/** Calls a Kibana HTTP API in the demo space. */
export const kibanaRequest = async <T>(
  connection: DemoConnection,
  method: string,
  path: string,
  body?: unknown
): Promise<HttpResult<T>> => {
  const spacePrefix = connection.space === 'default' ? '' : `/s/${connection.space}`;
  const url = `${connection.kibanaUrl}${spacePrefix}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      'kbn-xsrf': 'nightshift-demo',
      'x-elastic-internal-origin': 'nightshift-demo',
      'content-type': 'application/json',
      authorization: authHeader(connection.auth),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    dispatcher: dispatcherFor(url),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as T) : (undefined as T) };
};

/** Calls an Elasticsearch HTTP API. */
export const esRequest = async <T>(
  connection: DemoConnection,
  method: string,
  path: string,
  body?: unknown
): Promise<HttpResult<T>> => {
  const url = `${connection.esUrl}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: authHeader(connection.auth),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    dispatcher: dispatcherFor(url),
  });
  const text = await response.text();
  return { status: response.status, data: text ? (JSON.parse(text) as T) : (undefined as T) };
};

/** Writes documents to a data stream with one `_bulk` call and throws on the first error. */
export const bulkCreate = async (
  connection: DemoConnection,
  dataStream: string,
  documents: Array<Record<string, unknown>>
): Promise<void> => {
  if (documents.length === 0) {
    return;
  }
  const lines = documents.flatMap((document) => [
    JSON.stringify({ create: { _index: dataStream } }),
    JSON.stringify(document),
  ]);
  const url = `${connection.esUrl}/_bulk?refresh=wait_for`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-ndjson',
      authorization: authHeader(connection.auth),
    },
    body: `${lines.join('\n')}\n`,
    dispatcher: dispatcherFor(url),
  });
  const data = (await response.json()) as {
    errors: boolean;
    items: Array<{ create?: { error?: { reason?: string } } }>;
  };
  const firstError = data.items.find((item) => item.create?.error)?.create?.error;
  if (response.status >= 300 || data.errors) {
    throw new Error(
      `Bulk write to ${dataStream} failed (HTTP ${response.status}): ${
        firstError?.reason ?? 'unknown'
      }`
    );
  }
};
