/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { CoreStart } from '@kbn/core/server';
import type { KibanaRequest } from '@kbn/core-http-server';
import { addSpaceIdToPath } from '@kbn/spaces-plugin/server';

function buildInternalUrl(
  request: KibanaRequest,
  core: CoreStart,
  spaceId: string,
  path: string,
  query?: Record<string, string>
): string {
  const serverBasePath = core.http.basePath.serverBasePath;
  const pathWithSpace = addSpaceIdToPath(serverBasePath, spaceId, path);
  const publicBaseUrl = core.http.basePath.publicBaseUrl;
  if (publicBaseUrl) {
    const url = `${publicBaseUrl}${pathWithSpace}`;
    if (query && Object.keys(query).length > 0) {
      return `${url}?${new URLSearchParams(query).toString()}`;
    }
    return url;
  }
  const protocol = request.headers['x-forwarded-proto'] || 'http';
  const host = request.headers.host || 'localhost:5601';
  const baseUrl = `${protocol}://${host}`;
  const url = `${baseUrl}${pathWithSpace}`;
  if (query && Object.keys(query).length > 0) {
    return `${url}?${new URLSearchParams(query).toString()}`;
  }
  return url;
}

const HEADERS_TO_FORWARD = [
  'accept',
  'accept-encoding',
  'accept-language',
  'authorization',
  'content-type',
  'cookie',
  'kbn-build-number',
  'kbn-version',
  'x-elastic-internal-origin',
  'x-elastic-product-origin',
  'x-kbn-context',
];

function getForwardHeaders(request: KibanaRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const key of HEADERS_TO_FORWARD) {
    const value = request.headers[key];
    if (typeof value === 'string') {
      headers[key] = value;
    }
  }
  return headers;
}

export async function callStreamContext(
  request: KibanaRequest,
  core: CoreStart,
  spaceId: string,
  stream: string
): Promise<{ stream: string; features: unknown[]; queries: unknown[] }> {
  const url = buildInternalUrl(request, core, spaceId, '/internal/streams/stream_context', {
    stream,
  });
  const res = await fetch(url, {
    method: 'GET',
    headers: getForwardHeaders(request),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Streams stream_context failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function callSemanticCorrelate(
  request: KibanaRequest,
  core: CoreStart,
  spaceId: string,
  body: { query: string; stream?: string; size?: number; include_queries?: boolean }
): Promise<unknown> {
  const url = buildInternalUrl(request, core, spaceId, '/internal/streams/semantic_correlate');
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...getForwardHeaders(request), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Streams semantic_correlate failed (${res.status}): ${text}`);
  }
  return res.json();
}
