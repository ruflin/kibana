/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import Fs from 'fs';
import type { ConnectionOptions } from 'tls';
import { CA_CERT_PATH } from '@kbn/dev-utils';
import { Agent } from 'undici';
import { DEV_CERT_HOSTNAME } from './constants';
import { isLocalUrl, parseUrl } from './url';

export interface TlsPolicyOptions {
  /** Skip certificate verification. Only set this from an explicit user opt-in such as `--insecure`. */
  insecure?: boolean;
}

let devCa: Buffer | undefined;
const readDevCa = (): Buffer => {
  devCa ??= Fs.readFileSync(CA_CERT_PATH);
  return devCa;
};

/**
 * TLS options for connecting to `url`:
 * - http: none
 * - `insecure`: certificate verification disabled
 * - https on a local host: trust the Kibana dev CA and verify against `localhost`, which the
 *   dev certificates are issued for (so `127.0.0.1` works too)
 * - any other https host: Node defaults
 *
 * The result can be passed as `tls` to the Elasticsearch client, spread into `https.request`
 * options, or used as undici `connect` options.
 */
export const getTlsOptions = (
  url: string,
  { insecure = false }: TlsPolicyOptions = {}
): ConnectionOptions | undefined => {
  const parsed = parseUrl(url);
  if (parsed.protocol !== 'https:') {
    return undefined;
  }
  if (insecure) {
    return { rejectUnauthorized: false };
  }
  if (isLocalUrl(parsed)) {
    return { ca: readDevCa(), servername: DEV_CERT_HOSTNAME };
  }
  return undefined;
};

/** undici dispatcher applying {@link getTlsOptions}, for use as the `dispatcher` of `fetch`. */
export const getFetchDispatcher = (
  url: string,
  options: TlsPolicyOptions = {}
): Agent | undefined => {
  const tls = getTlsOptions(url, options);
  return tls ? new Agent({ connect: tls }) : undefined;
};
