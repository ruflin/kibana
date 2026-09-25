/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

export type { ApiKeyAuth, BasicAuth, ConnectionAuth } from './src/auth';
export {
  getLocalStackOptionsFromFlags,
  LOCAL_STACK_FLAG_OPTIONS,
  LOCAL_STACK_FLAGS_HELP,
} from './src/cli_flags';
export type { KibanaFetchInit } from './src/kibana_fetch';
export { runLocalStackCli } from './src/local_stack_cli';
export { kibanaFetch } from './src/kibana_fetch';
export type { KibanaConnection, ResolveKibanaOptions } from './src/resolve_kibana';
export { KIBANA_REQUEST_HEADERS, resolveKibana } from './src/resolve_kibana';
export type { LocalStackConnection, ResolveLocalStackOptions } from './src/resolve_local_stack';
export { resolveLocalStack } from './src/resolve_local_stack';
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
