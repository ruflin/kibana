/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

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
  const response = await fetch(`${connection.kibanaUrl}${spacePrefix}${path}`, {
    method,
    headers: {
      'kbn-xsrf': 'nightshift-demo',
      'x-elastic-internal-origin': 'nightshift-demo',
      'content-type': 'application/json',
      authorization: authHeader(connection.auth),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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
  const response = await fetch(`${connection.esUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: authHeader(connection.auth),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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
  const response = await fetch(`${connection.esUrl}/_bulk?refresh=wait_for`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-ndjson',
      authorization: authHeader(connection.auth),
    },
    body: `${lines.join('\n')}\n`,
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
