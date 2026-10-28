/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ActionContext } from '../../connector_spec';

const API_PATH = '/api/v1';

/** One page of a Gitea list response, with the paging data the agent needs to ask for the next. */
export interface GiteaPage {
  values: unknown[];
  page: number;
  limit: number;
  /** Total number of matching items, or null when the server did not report it. */
  total: number | null;
  hasMore: boolean;
}

interface HeaderBag {
  headers?: Record<string, unknown>;
}

const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end--;
  }
  return value.slice(0, end);
};

/**
 * Build the REST API root from the configured instance URL. A URL that already ends in `/api/v1`
 * is accepted as is, so both `https://gitea.example.com` and `https://gitea.example.com/api/v1`
 * work, as does an instance served from a sub-path such as `https://example.com/gitea`.
 */
export const getApiBase = (ctx: ActionContext): string => {
  const baseUrl = ctx.config?.baseUrl;
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('The Gitea instance URL is not configured on this connector.');
  }
  const instanceUrl = trimTrailingSlashes(baseUrl);
  const root = instanceUrl.endsWith(API_PATH)
    ? instanceUrl.slice(0, instanceUrl.length - API_PATH.length)
    : instanceUrl;
  return `${trimTrailingSlashes(root)}${API_PATH}`;
};

/** The `/repos/{owner}/{repo}` path with both segments URL-encoded. */
export const repoPath = (owner: string, repo: string): string =>
  `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

/** URL-encode each segment of a repository file path while keeping the `/` separators. */
export const encodeFilePath = (filePath: string): string =>
  filePath.split('/').map(encodeURIComponent).join('/');

/** Remove undefined entries so they are not serialized as empty query parameters. */
export const compact = (params: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined));

const readHeader = (headers: Record<string, unknown> | undefined, name: string): string => {
  const value = headers?.[name];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

/**
 * Wrap a Gitea list response with paging data. Gitea reports the total in `X-Total-Count` and
 * advertises further pages with a `Link: <...>; rel="next"` header. The link itself is never
 * followed: the agent asks for the next page by number, so the connector always builds the URL.
 */
export const toPage = (
  values: unknown[],
  response: HeaderBag,
  paging: { page: number; limit: number },
  totalOverride?: number
): GiteaPage => {
  const totalHeader = readHeader(response.headers, 'x-total-count');
  const parsedTotal = totalOverride ?? (totalHeader === '' ? NaN : Number(totalHeader));
  const total = Number.isFinite(parsedTotal) ? parsedTotal : null;
  const hasNextLink = /rel="?next"?/.test(readHeader(response.headers, 'link'));
  const hasMore =
    hasNextLink ||
    readHeader(response.headers, 'x-hasmore') === 'true' ||
    (total !== null && paging.page * paging.limit < total);
  return { values, page: paging.page, limit: paging.limit, total, hasMore };
};
