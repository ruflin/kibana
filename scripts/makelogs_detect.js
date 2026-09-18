/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/**
 * Detect a local Elasticsearch dest for scripts/makelogs.js.
 * @elastic/makelogs defaults to localhost:9200 with no auth, which 401s on
 * secured stateful (elastic:changeme) and serverless (elastic_serverless:changeme).
 */

var http = require('http');
var https = require('https');

var DEFAULT_HOSTS = ['http://localhost:9200', 'https://localhost:9200'];
var DEFAULT_AUTHS = [
  { username: 'elastic', password: 'changeme' },
  { username: 'elastic_serverless', password: 'changeme' },
];

function hasUserConnectionFlags(argv) {
  argv = argv || process.argv.slice(2);
  for (var i = 0; i < argv.length; i++) {
    var arg = argv[i];
    if (
      arg === '--url' ||
      arg.indexOf('--url=') === 0 ||
      arg === '--auth' ||
      arg.indexOf('--auth=') === 0 ||
      arg === '--host' ||
      arg.indexOf('--host=') === 0 ||
      arg === '-h' ||
      arg.indexOf('-h=') === 0
    ) {
      return true;
    }
  }
  return false;
}

function coerceHttpUrl(host) {
  var raw = String(host || '')
    .trim()
    .replace(/\/$/, '');
  if (!raw) return null;
  try {
    var parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed;
    }
  } catch (err) {
    // fall through
  }
  try {
    return new URL('http://' + raw.replace(/^\/\//, ''));
  } catch (err2) {
    return null;
  }
}

function oppositeProtocolUrl(nodeUrl) {
  var parsed = coerceHttpUrl(nodeUrl);
  if (!parsed) return null;
  parsed.protocol = parsed.protocol === 'https:' ? 'http:' : 'https:';
  return parsed.toString().replace(/\/$/, '');
}

function uniqueStrings(values) {
  var seen = {};
  var out = [];
  values.forEach(function (value) {
    if (!value || seen[value]) return;
    seen[value] = true;
    out.push(value);
  });
  return out;
}

function hostCandidates(destHost) {
  if (!destHost) return DEFAULT_HOSTS.slice();
  var configured = coerceHttpUrl(destHost);
  if (!configured) return DEFAULT_HOSTS.slice();
  var primary = configured.toString().replace(/\/$/, '');
  return uniqueStrings([primary, oppositeProtocolUrl(primary)]);
}

function authCandidates(username, password) {
  var configured = {
    username: username || 'elastic',
    password: password || 'changeme',
  };
  var auths = [configured];
  DEFAULT_AUTHS.forEach(function (stock) {
    var exists = auths.some(function (existing) {
      return existing.username === stock.username && existing.password === stock.password;
    });
    if (!exists) auths.push(stock);
  });
  return auths;
}

function pingEs(nodeUrl, username, password) {
  return new Promise(function (resolve) {
    var parsed = coerceHttpUrl(nodeUrl);
    if (!parsed) {
      resolve(0);
      return;
    }
    var isHttps = parsed.protocol === 'https:';
    var lib = isHttps ? https : http;
    var hostname = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
    var req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: '/',
        method: 'GET',
        rejectUnauthorized: false,
        timeout: 2000,
        headers: {
          Authorization: 'Basic ' + Buffer.from(username + ':' + password).toString('base64'),
        },
      },
      function (res) {
        res.resume();
        resolve(res.statusCode || 0);
      }
    );
    req.on('timeout', function () {
      req.destroy();
      resolve(0);
    });
    req.on('error', function () {
      resolve(0);
    });
    req.end();
  });
}

function candidateToMakelogsUrl(destHost, username, password) {
  var parsed = coerceHttpUrl(destHost);
  if (!parsed) return null;
  parsed.username = username || '';
  parsed.password = password || '';
  return parsed.toString().replace(/\/$/, '');
}

function detectLocalEs(options) {
  options = options || {};
  var ping = options.ping || pingEs;
  var destHost = options.destHost || process.env.ELASTICSEARCH_HOST;
  var destUsername = options.destUsername || process.env.ELASTICSEARCH_USERNAME || 'elastic';
  var destPassword = options.destPassword || process.env.ELASTICSEARCH_PASSWORD || 'changeme';

  var hosts = hostCandidates(destHost);
  var auths = authCandidates(destUsername, destPassword);
  var candidates = [];
  hosts.forEach(function (host) {
    auths.forEach(function (auth) {
      candidates.push({
        destHost: host,
        destUsername: auth.username,
        destPassword: auth.password,
      });
    });
  });

  var index = 0;
  function tryNext() {
    if (index >= candidates.length) {
      return Promise.resolve(null);
    }
    var candidate = candidates[index];
    index += 1;
    return ping(candidate.destHost, candidate.destUsername, candidate.destPassword).then(function (
      statusCode
    ) {
      if (statusCode === 200) {
        var parsed = coerceHttpUrl(candidate.destHost);
        return {
          url: candidateToMakelogsUrl(
            candidate.destHost,
            candidate.destUsername,
            candidate.destPassword
          ),
          destHost: candidate.destHost,
          username: candidate.destUsername,
          insecure: parsed && parsed.protocol === 'https:',
        };
      }
      return tryNext();
    });
  }

  return tryNext();
}

function injectDetectedArgv(detected, argv) {
  argv = argv || process.argv;
  argv.push('--url', detected.url);
  if (detected.insecure) {
    argv.push('--insecure');
  }
  return argv;
}

module.exports = {
  hasUserConnectionFlags: hasUserConnectionFlags,
  pingEs: pingEs,
  candidateToMakelogsUrl: candidateToMakelogsUrl,
  detectLocalEs: detectLocalEs,
  injectDetectedArgv: injectDetectedArgv,
};
