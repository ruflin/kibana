/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const dest = require('./sync_logs_dest');

describe('coerceDestUrl', () => {
  it('keeps http and https URLs', () => {
    assert.equal(dest.coerceDestUrl('http://localhost:9200').href, 'http://localhost:9200/');
    assert.equal(dest.coerceDestUrl('https://localhost:9200').href, 'https://localhost:9200/');
  });

  it('treats protocol-less localhost:9200 as http, not as protocol "localhost:"', () => {
    const parsed = dest.coerceDestUrl('localhost:9200');
    assert.equal(parsed.protocol, 'http:');
    assert.equal(parsed.hostname, 'localhost');
    assert.equal(parsed.port, '9200');
  });
});

describe('isLocalhostUrl', () => {
  it('accepts protocol-less local hosts', () => {
    assert.equal(dest.isLocalhostUrl('localhost:9200'), true);
    assert.equal(dest.isLocalhostUrl('127.0.0.1:9200'), true);
  });

  it('accepts http(s) localhost variants', () => {
    assert.equal(dest.isLocalhostUrl('https://localhost:9200'), true);
    assert.equal(dest.isLocalhostUrl('http://127.0.0.1:9200'), true);
    assert.equal(dest.isLocalhostUrl('https://[::1]:9200'), true);
    assert.equal(dest.isLocalhostUrl('http://0.0.0.0:9200'), true);
    assert.equal(dest.isLocalhostUrl('https://host.docker.internal:9200'), true);
  });

  it('rejects remote hosts', () => {
    assert.equal(dest.isLocalhostUrl('https://es.example.com:9200'), false);
    assert.equal(dest.isLocalhostUrl('https://elasticsearch:9200'), false);
  });
});

describe('destHostCandidates', () => {
  it('tries HTTP then HTTPS for local dest, preserving hostname', () => {
    assert.deepEqual(dest.destHostCandidates({ destHost: 'https://localhost:9200' }), [
      'http://localhost:9200',
      'https://localhost:9200',
    ]);
    assert.deepEqual(dest.destHostCandidates({ destHost: 'https://127.0.0.1:9200' }), [
      'http://127.0.0.1:9200',
      'https://127.0.0.1:9200',
    ]);
  });

  it('expands protocol-less localhost so the ES client does not default to TLS', () => {
    assert.deepEqual(dest.destHostCandidates({ destHost: 'localhost:9200' }), [
      'http://localhost:9200',
      'https://localhost:9200',
    ]);
  });

  it('preserves an explicit default https port instead of rewriting it to 9200', () => {
    assert.deepEqual(dest.destHostCandidates({ destHost: 'https://localhost:443' }), [
      'http://localhost:443',
      'https://localhost:443',
    ]);
  });

  it('does not invent an HTTP candidate for a remote HTTPS dest', () => {
    assert.deepEqual(dest.destHostCandidates({ destHost: 'https://es.example.com:9243' }), [
      'https://es.example.com:9243',
    ]);
  });
});

describe('destAuthCandidates', () => {
  it('still tries stock local users when kibana.dev.yml has kibana_system', () => {
    const auths = dest.destAuthCandidates({
      destHost: 'http://localhost:9200',
      destUsername: 'kibana_system',
      destPassword: 'generated',
    });
    assert.deepEqual(auths, [
      { username: 'kibana_system', password: 'generated' },
      { username: 'elastic', password: 'changeme' },
      { username: 'elastic_serverless', password: 'changeme' },
    ]);
  });

  it('does not add stock users for a remote dest', () => {
    const auths = dest.destAuthCandidates({
      destHost: 'https://es.example.com:9243',
      destUsername: 'elastic',
      destPassword: 'changeme',
    });
    assert.deepEqual(auths, [{ username: 'elastic', password: 'changeme' }]);
  });
});

describe('protocol mismatch fallback', () => {
  it('detects OpenSSL wrong version number from HTTPS-to-HTTP', () => {
    assert.equal(
      dest.isProtocolMismatchError({
        message:
          'C0A1E2F401000000:error:0A00010B:SSL routines:tls_validate_record_header:wrong version number',
      }),
      true
    );
    assert.equal(dest.isProtocolMismatchError({ message: 'ECONNREFUSED' }), false);
  });

  it('adds an HTTP candidate when dest was HTTPS-only', () => {
    const extras = dest.appendOppositeProtocolCandidates([
      {
        destHost: 'https://elasticsearch:9200',
        destUsername: 'elastic',
        destPassword: 'changeme',
      },
    ]);
    assert.deepEqual(extras, [
      {
        destHost: 'http://elasticsearch:9200',
        destUsername: 'elastic',
        destPassword: 'changeme',
      },
    ]);
  });
});

describe('getTlsOptions', () => {
  it('skips verification for local HTTPS and leaves HTTP alone', () => {
    assert.deepEqual(dest.getTlsOptions('https://localhost:9200', false), {
      rejectUnauthorized: false,
    });
    assert.equal(dest.getTlsOptions('http://localhost:9200', false), undefined);
  });
});

describe('firstEsHost', () => {
  it('unwraps yaml array hosts', () => {
    assert.equal(dest.firstEsHost(['https://localhost:9200']), 'https://localhost:9200');
    assert.equal(dest.firstEsHost('http://localhost:9200'), 'http://localhost:9200');
  });
});
