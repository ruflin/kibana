/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { fetch } from 'undici';
import type { ConnectionAuth } from './auth';
import { getAuthorizationHeader } from './auth';
import { PROBE_TIMEOUT_MS } from './constants';
import type { TlsPolicyOptions } from './tls';
import { getFetchDispatcher } from './tls';

export type ProbeResult =
  | { kind: 'ok'; status: number; body: unknown }
  | { kind: 'redirect'; status: number; location: string }
  | { kind: 'unauthorized'; status: number }
  | { kind: 'unexpected_status'; status: number }
  | { kind: 'unreachable'; reason: string };

export interface ProbeOptions extends TlsPolicyOptions {
  url: string;
  auth?: ConnectionAuth;
  headers?: Record<string, string>;
}

interface ErrorLike {
  name?: string;
  message?: string;
  cause?: unknown;
  code?: string;
  errors?: ErrorLike[];
}

const isErrorLike = (value: unknown): value is ErrorLike =>
  typeof value === 'object' && value !== null && 'message' in value;

const getErrorReason = (error: unknown): string => {
  if (!isErrorLike(error)) {
    return String(error);
  }
  const { cause, code, errors, name = 'Error' } = error;
  if (isErrorLike(cause)) {
    return getErrorReason(cause);
  }
  // Connecting to `localhost` tries every resolved address and fails with an AggregateError.
  const message = error.message || errors?.[0]?.message || name;
  return code && !message.includes(code) ? `${code}: ${message}` : message;
};

const readBody = async (response: Awaited<ReturnType<typeof fetch>>): Promise<unknown> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** Sends a single GET request without retries or redirect following and classifies the outcome. */
export const probe = async ({
  url,
  auth,
  headers,
  insecure,
}: ProbeOptions): Promise<ProbeResult> => {
  const dispatcher = getFetchDispatcher(url, { insecure });
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      dispatcher,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: {
        ...headers,
        ...(auth ? { Authorization: getAuthorizationHeader(auth) } : {}),
      },
    });
    const { status } = response;
    if (status === 401) {
      await response.body?.cancel();
      return { kind: 'unauthorized', status };
    }
    if (status >= 300 && status < 400) {
      await response.body?.cancel();
      return { kind: 'redirect', status, location: response.headers.get('location') ?? '' };
    }
    if (status >= 200 && status < 300) {
      return { kind: 'ok', status, body: await readBody(response) };
    }
    await response.body?.cancel();
    return { kind: 'unexpected_status', status };
  } catch (error) {
    return { kind: 'unreachable', reason: getErrorReason(error) };
  } finally {
    await dispatcher?.close();
  }
};
