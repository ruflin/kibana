/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import Fs from 'fs';
import { CA_CERT_PATH } from '@kbn/dev-utils';
import { getTlsOptions } from './tls';

describe('getTlsOptions', () => {
  it('returns nothing for http', () => {
    expect(getTlsOptions('http://localhost:9200')).toBeUndefined();
  });

  it.each(['https://localhost:9200', 'https://127.0.0.1:9200', 'https://[::1]:9200'])(
    'trusts the dev CA for %s',
    (url) => {
      expect(getTlsOptions(url)).toEqual({
        ca: Fs.readFileSync(CA_CERT_PATH),
        servername: 'localhost',
      });
    }
  );

  it('keeps Node defaults for remote hosts', () => {
    expect(getTlsOptions('https://my-deployment.es.example.com')).toBeUndefined();
  });

  it('only disables verification when insecure is requested', () => {
    expect(getTlsOptions('https://my-deployment.es.example.com', { insecure: true })).toEqual({
      rejectUnauthorized: false,
    });
    expect(getTlsOptions('http://localhost:9200', { insecure: true })).toBeUndefined();
  });
});
