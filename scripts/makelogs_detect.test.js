/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const detect = require('./makelogs_detect');

describe('hasUserConnectionFlags', () => {
  it('is false for count/days-only argv', () => {
    assert.equal(detect.hasUserConnectionFlags(['-c', '1000', '-d', '1']), false);
  });

  it('is true when --auth, --url, or --host is set', () => {
    assert.equal(detect.hasUserConnectionFlags(['--auth', 'elastic:changeme']), true);
    assert.equal(detect.hasUserConnectionFlags(['--url=http://localhost:9200']), true);
    assert.equal(detect.hasUserConnectionFlags(['-h', 'localhost:9201']), true);
  });
});

describe('detectLocalEs', () => {
  let server;
  let port;

  before(async () => {
    server = http.createServer((req, res) => {
      const header = req.headers.authorization || '';
      const expected = 'Basic ' + Buffer.from('elastic_serverless:changeme').toString('base64');
      if (header === expected) {
        res.writeHead(200);
        res.end('ok');
        return;
      }
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="security"' });
      res.end();
    });
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('skips 401 elastic and uses elastic_serverless on the same HTTP port', async () => {
    const detected = await detect.detectLocalEs({
      destHost: `http://127.0.0.1:${port}`,
    });
    assert.ok(detected);
    assert.equal(detected.username, 'elastic_serverless');
    assert.equal(detected.destHost, `http://127.0.0.1:${port}`);
    assert.equal(detected.insecure, false);
    assert.match(detected.url, /elastic_serverless:changeme@127\.0\.0\.1/);
  });

  it('returns null when every candidate is 401', async () => {
    const detected = await detect.detectLocalEs({
      destHost: `http://127.0.0.1:${port}`,
      ping: async () => 401,
    });
    assert.equal(detected, null);
  });
});

describe('injectDetectedArgv', () => {
  it('adds --url and --insecure for HTTPS dest', () => {
    const argv = ['node', 'scripts/makelogs.js', '-d', '1'];
    detect.injectDetectedArgv(
      {
        url: 'https://elastic:changeme@localhost:9200',
        insecure: true,
      },
      argv
    );
    assert.deepEqual(argv, [
      'node',
      'scripts/makelogs.js',
      '-d',
      '1',
      '--url',
      'https://elastic:changeme@localhost:9200',
      '--insecure',
    ]);
  });
});
