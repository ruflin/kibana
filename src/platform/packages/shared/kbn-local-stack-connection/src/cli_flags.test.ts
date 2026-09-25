/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { getLocalStackOptionsFromFlags } from './cli_flags';

describe('getLocalStackOptionsFromFlags', () => {
  it('maps flags to resolver options and ignores empty values', () => {
    expect(
      getLocalStackOptionsFromFlags({
        'es-url': 'https://localhost:9200',
        'es-username': '',
        'kibana-url': 'http://localhost:5601/abc',
        'kibana-api-key': 'key',
        insecure: true,
      })
    ).toEqual({
      elasticsearch: {
        url: 'https://localhost:9200',
        username: undefined,
        password: undefined,
        apiKey: undefined,
      },
      kibana: {
        url: 'http://localhost:5601/abc',
        username: undefined,
        password: undefined,
        apiKey: 'key',
      },
      insecure: true,
    });
  });
});
