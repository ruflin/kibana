/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export type { ApiKeyAuth, BasicAuth, ConnectionAuth } from './src/auth';
export { describeAuth, getAuthorizationHeader, isApiKeyAuth } from './src/auth';
export {
  DEV_CERT_HOSTNAME,
  LOCAL_ES_PORT,
  LOCAL_HOSTNAMES,
  LOCAL_KIBANA_PORT,
  LOCAL_SUPERUSERS,
  SERVERLESS_SUPERUSER,
  STATEFUL_SUPERUSER,
} from './src/constants';
export type { KibanaDevConfig } from './src/kibana_dev_config';
export {
  DEFAULT_KIBANA_DEV_CONFIG_PATH,
  getKibanaDevConfigCredentials,
  readKibanaDevConfig,
} from './src/kibana_dev_config';
export type {
  ElasticsearchConnection,
  ElasticsearchFlavor,
  ResolveElasticsearchOptions,
} from './src/resolve_elasticsearch';
export { getEsClientOptions, resolveElasticsearch } from './src/resolve_elasticsearch';
export type { TlsPolicyOptions } from './src/tls';
export { getFetchDispatcher, getTlsOptions } from './src/tls';
export { isLocalUrl, parseUrl } from './src/url';
