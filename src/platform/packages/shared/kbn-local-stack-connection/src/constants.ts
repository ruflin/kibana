/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { BasicAuth } from './auth';

export const LOCAL_ES_PORT = 9200;
export const LOCAL_KIBANA_PORT = 5601;

/** Superuser created by `node scripts/es snapshot` (stateful). */
export const STATEFUL_SUPERUSER: Readonly<BasicAuth> = {
  username: 'elastic',
  password: 'changeme',
};

/** Superuser created by `node scripts/es serverless` (file realm). */
export const SERVERLESS_SUPERUSER: Readonly<BasicAuth> = {
  username: 'elastic_serverless',
  password: 'changeme',
};

/** Default superusers of the local dev stacks, in the order they are probed. */
export const LOCAL_SUPERUSERS: readonly BasicAuth[] = [STATEFUL_SUPERUSER, SERVERLESS_SUPERUSER];

/**
 * Hostnames that are served by the local dev stack. The dev certificates in `@kbn/dev-utils`
 * are issued for `localhost` (and a few Docker names) but not for IP addresses.
 */
export const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  'host.docker.internal',
]);

/** Hostname that every dev certificate is issued for. */
export const DEV_CERT_HOSTNAME = 'localhost';

export const PROBE_TIMEOUT_MS = 5_000;
