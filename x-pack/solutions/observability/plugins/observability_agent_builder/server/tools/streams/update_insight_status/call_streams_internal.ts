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
  path: string
): string {
  const serverBasePath = core.http.basePath.serverBasePath;
  const pathWithSpace = addSpaceIdToPath(serverBasePath, spaceId, path);
  const publicBaseUrl = core.http.basePath.publicBaseUrl;
  if (publicBaseUrl) {
    return `${publicBaseUrl}${pathWithSpace}`;
  }
  const protocol = request.headers['x-forwarded-proto'] || 'http';
  const host = request.headers.host || 'localhost:5601';
  return `${protocol}://${host}${pathWithSpace}`;
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

export async function callStreamsInsightUpdateStatus(
  request: KibanaRequest,
  core: CoreStart,
  spaceId: string,
  streamName: string,
  insightUuid: string,
  body: { status: string }
): Promise<unknown> {
  const url = buildInternalUrl(
    request,
    core,
    spaceId,
    `/internal/streams/${encodeURIComponent(streamName)}/insights/${encodeURIComponent(insightUuid)}`
  );
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...getForwardHeaders(request),
      'content-type': 'application/json',
      'kbn-xsrf': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Streams insight status update failed (${res.status}): ${text}`);
  }
  return res.json();
}
