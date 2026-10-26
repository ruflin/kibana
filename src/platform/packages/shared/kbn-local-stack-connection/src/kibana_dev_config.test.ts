/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import Fs from 'fs';
import Os from 'os';
import Path from 'path';
import { getKibanaDevConfigCredentials, readKibanaDevConfig } from './kibana_dev_config';

const writeConfig = (contents: string): string => {
  const path = Path.join(Os.tmpdir(), `kibana_dev_config_${Date.now()}_${Math.random()}.yml`);
  Fs.writeFileSync(path, contents);
  return path;
};

describe('readKibanaDevConfig', () => {
  it('returns an empty config when the file is missing', () => {
    const config = readKibanaDevConfig(Path.join(Os.tmpdir(), 'does-not-exist.yml'));
    expect(config).toMatchObject({
      exists: false,
      elasticsearch: { hosts: [] },
      server: { sslEnabled: false },
    });
  });

  it('merges dotted and nested keys regardless of order', () => {
    const path = writeConfig(
      [
        'elasticsearch.hosts: http://localhost:9200',
        'elasticsearch:',
        '  username: elastic',
        '  password: changeme',
        'server:',
        '  basePath: /kbn',
        'server.port: 5611',
        'server.ssl.enabled: true',
      ].join('\n')
    );

    try {
      expect(readKibanaDevConfig(path)).toMatchObject({
        exists: true,
        elasticsearch: {
          hosts: ['http://localhost:9200'],
          username: 'elastic',
          password: 'changeme',
        },
        server: { basePath: '/kbn', port: 5611, sslEnabled: true },
      });
    } finally {
      Fs.rmSync(path);
    }
  });
});

describe('getKibanaDevConfigCredentials', () => {
  it('ignores the kibana_system user', () => {
    const path = writeConfig('elasticsearch.username: kibana_system\nelasticsearch.password: x');
    try {
      expect(getKibanaDevConfigCredentials(readKibanaDevConfig(path))).toBeUndefined();
    } finally {
      Fs.rmSync(path);
    }
  });

  it('returns other users', () => {
    const path = writeConfig('elasticsearch.username: admin\nelasticsearch.password: secret');
    try {
      expect(getKibanaDevConfigCredentials(readKibanaDevConfig(path))).toEqual({
        username: 'admin',
        password: 'secret',
      });
    } finally {
      Fs.rmSync(path);
    }
  });
});
