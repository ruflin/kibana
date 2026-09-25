/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { BasicAuth } from './auth';
import { LOCAL_HOSTNAMES } from './constants';

/**
 * Parses a user supplied URL. Protocol-less values such as `localhost:9200` are treated as
 * `http://localhost:9200` (WHATWG would otherwise parse `localhost:` as the protocol).
 */
export const parseUrl = (rawUrl: string): URL => {
  const trimmed = rawUrl.trim();
  return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
};

/** Returns the URL without credentials, query, hash, or trailing slash. */
export const toBaseUrl = (url: URL): string => {
  const copy = new URL(url.toString());
  copy.username = '';
  copy.password = '';
  copy.search = '';
  copy.hash = '';
  return copy.toString().replace(/\/+$/, '');
};

/** Extracts `user:pass@` credentials from a URL, if present. */
export const getUrlCredentials = (url: URL): BasicAuth | undefined =>
  url.username
    ? {
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      }
    : undefined;

export const isLocalUrl = (url: string | URL): boolean =>
  LOCAL_HOSTNAMES.has((typeof url === 'string' ? parseUrl(url) : url).hostname);

/** Returns the same URL with http and https swapped. */
export const withSwitchedProtocol = (baseUrl: string): string => {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'http:' : 'https:';
  return toBaseUrl(url);
};
