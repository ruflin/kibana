/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export interface BasicAuth {
  username: string;
  password: string;
}

export interface ApiKeyAuth {
  apiKey: string;
}

export type ConnectionAuth = BasicAuth | ApiKeyAuth;

export const isApiKeyAuth = (auth: ConnectionAuth): auth is ApiKeyAuth => 'apiKey' in auth;

/** Returns the value for the HTTP `Authorization` header. */
export const getAuthorizationHeader = (auth: ConnectionAuth): string =>
  isApiKeyAuth(auth)
    ? `ApiKey ${auth.apiKey}`
    : `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;

/** Human readable description of the auth, without secrets. */
export const describeAuth = (auth: ConnectionAuth): string =>
  isApiKeyAuth(auth) ? 'API key' : `user "${auth.username}"`;
