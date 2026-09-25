/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { Agent, RequestInit, Response } from 'undici';
import { fetch } from 'undici';
import { getAuthorizationHeader } from './auth';
import type { KibanaConnection } from './resolve_kibana';
import { KIBANA_REQUEST_HEADERS } from './resolve_kibana';
import { getFetchDispatcher } from './tls';

const dispatchers = new WeakMap<KibanaConnection, Agent | undefined>();

const getDispatcher = (connection: KibanaConnection): Agent | undefined => {
  if (!dispatchers.has(connection)) {
    dispatchers.set(
      connection,
      getFetchDispatcher(connection.url, { insecure: connection.insecure })
    );
  }
  return dispatchers.get(connection);
};

export interface KibanaFetchInit extends Omit<RequestInit, 'dispatcher' | 'headers'> {
  headers?: Record<string, string>;
}

/**
 * `fetch` against a resolved Kibana: prefixes the base URL and adds auth, the required Kibana
 * headers, the TLS policy, and a JSON content type for string bodies.
 */
export const kibanaFetch = (
  connection: KibanaConnection,
  path: string,
  { headers, ...init }: KibanaFetchInit = {}
): Promise<Response> =>
  fetch(`${connection.url}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    dispatcher: getDispatcher(connection),
    headers: {
      ...KIBANA_REQUEST_HEADERS,
      ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
      Authorization: getAuthorizationHeader(connection.auth),
      ...headers,
    },
  });
