/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest, Logger } from '@kbn/core/server';
import { StatusError } from '../errors/status_error';
import { ENTITY_STORE_PUBLIC_API_VERSION } from './constants';

/**
 * Entity Store POC — see `constants.ts` for why this exists instead of a plugin import.
 *
 * Calls the Security Entity Store's real public HTTP API as a server-to-server loopback,
 * forwarding the original caller's auth. This is unusual for same-deployment Kibana code
 * (normally you'd depend on the other plugin's contract), and it is precisely the
 * awkwardness the module-boundary rules are meant to surface: writing "through the CRUD
 * API" from a platform plugin currently requires a real network hop rather than a
 * function call. That is itself one of this POC's findings, not an accident of this
 * implementation.
 *
 * Because the call is forwarded with the original user's credentials, the entity store's
 * own authorization (`requiredPrivileges: ['securitySolution']`) still applies in full —
 * this only works today because the local dev superuser has every privilege. A real
 * Observability role would 403 here, which is the "Authorization" blocker tracked in the
 * POC issue.
 */

export interface EntityStoreApiCallParams {
  request: KibanaRequest;
  kibanaBaseUrl: string;
  logger: Logger;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path under the entity store's public base, e.g. `/api/security/entity_store/entities/service`. */
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

function buildForwardedHeaders(request: KibanaRequest): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'kbn-xsrf': 'true',
    'x-elastic-internal-origin': 'kibana',
    'elastic-api-version': ENTITY_STORE_PUBLIC_API_VERSION,
  };

  const authorization = request.headers.authorization;
  if (typeof authorization === 'string') {
    headers.authorization = authorization;
  }

  const cookie = request.headers.cookie;
  if (typeof cookie === 'string') {
    headers.cookie = cookie;
  }

  return headers;
}

export async function callEntityStoreApi<TResponse = any>({
  request,
  kibanaBaseUrl,
  logger,
  method,
  path,
  query,
  body,
}: EntityStoreApiCallParams): Promise<TResponse> {
  const url = new URL(path, kibanaBaseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  logger.debug(`entity_store_poc: ${method} ${url.pathname}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: buildForwardedHeaders(request),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new StatusError(
      `Entity Store POC: failed to reach the entity store API at ${url.pathname}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      502
    );
  }

  const text = await response.text();
  const parsed: unknown = text.length > 0 ? safeJsonParse(text) : undefined;

  if (!response.ok) {
    const message =
      parsed && typeof parsed === 'object' && parsed !== null && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : text || response.statusText;
    throw new StatusError(
      `Entity Store POC: ${method} ${url.pathname} returned ${response.status}: ${message}`,
      response.status
    );
  }

  return parsed as TResponse;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
