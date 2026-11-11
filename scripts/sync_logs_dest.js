/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/**
 * Destination Elasticsearch connection helpers for scripts/sync_logs.js.
 * Pure Node (no Kibana/ES client deps) so dest detection can be unit-tested.
 */

var LOCAL_HOSTS = {
  localhost: true,
  '127.0.0.1': true,
  '::1': true,
  '[::1]': true,
  '0.0.0.0': true,
  'host.docker.internal': true,
};

var DEFAULT_DEST_AUTHS = [
  { username: 'elastic', password: 'changeme' },
  { username: 'elastic_serverless', password: 'changeme' },
];

function firstEsHost(hosts) {
  if (hosts == null) return undefined;
  if (Array.isArray(hosts)) return firstEsHost(hosts[0]);
  if (typeof hosts === 'string') {
    var trimmed = hosts.trim();
    return trimmed || undefined;
  }
  return undefined;
}

function stripTrailingSlash(url) {
  return String(url || '').replace(/\/$/, '');
}

/**
 * Turn dest host strings into a WHATWG http(s) URL.
 * `localhost:9200` parses as protocol "localhost:" (empty hostname); prepend http://
 * so detection and the ES client see a real HTTP URL instead of defaulting to TLS.
 */
function coerceDestUrl(host) {
  var raw = stripTrailingSlash(String(host || '').trim());
  if (!raw) return null;
  try {
    var parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed;
    }
  } catch (err) {
    // fall through and try with an explicit http:// prefix
  }
  try {
    return new URL('http://' + raw.replace(/^\/\//, ''));
  } catch (err2) {
    return null;
  }
}

function isLocalhostUrl(nodeUrl) {
  var parsed = coerceDestUrl(nodeUrl);
  if (!parsed) return false;
  return Boolean(LOCAL_HOSTS[parsed.hostname]);
}

function explicitPort(originalHost, parsed) {
  if (parsed.port) return parsed.port;
  var match = String(originalHost).match(/:(\d+)(?:\/|$)/);
  if (match) return match[1];
  return '9200';
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

function formatDestUrl(protocol, hostname, port, pathname) {
  var hostPart = hostname === '::1' ? '[::1]' : hostname;
  var path = pathname && pathname !== '/' ? pathname.replace(/\/$/, '') : '';
  return protocol + '//' + hostPart + ':' + port + path;
}

function destHostCandidates(config) {
  var host = stripTrailingSlash(String((config && config.destHost) || '').trim());
  var parsed = coerceDestUrl(host);
  if (!parsed) {
    return ['http://localhost:9200', 'https://localhost:9200'];
  }

  var port = explicitPort(host, parsed);
  var configured = formatDestUrl(parsed.protocol, parsed.hostname, port, parsed.pathname);
  if (!isLocalhostUrl(configured)) {
    return [configured];
  }

  return uniqueStrings([
    formatDestUrl('http:', parsed.hostname, port, parsed.pathname),
    formatDestUrl('https:', parsed.hostname, port, parsed.pathname),
  ]);
}

function destAuthCandidates(config) {
  if (config && config.destApiKey) {
    return [{ apiKey: config.destApiKey }];
  }

  var configured = {
    username: (config && config.destUsername) || 'elastic',
    password: (config && config.destPassword) || 'changeme',
  };
  if (!isLocalhostUrl(config && config.destHost)) {
    return [configured];
  }

  var auths = [];
  function add(auth) {
    var exists = auths.some(function (existing) {
      return existing.username === auth.username && existing.password === auth.password;
    });
    if (!exists) auths.push(auth);
  }
  add(configured);
  DEFAULT_DEST_AUTHS.forEach(add);
  return auths;
}

function destCandidates(config) {
  var hosts = destHostCandidates(config);
  var auths = destAuthCandidates(config);
  var out = [];
  hosts.forEach(function (host) {
    auths.forEach(function (auth) {
      out.push({
        destHost: host,
        destApiKey: auth.apiKey,
        destUsername: auth.username,
        destPassword: auth.password,
      });
    });
  });
  return out;
}

function formatDestCandidate(candidate) {
  if (candidate.destApiKey) {
    return candidate.destHost + ' (api key)';
  }
  return candidate.destHost + ' as ' + candidate.destUsername;
}

function applyDestCandidate(config, candidate) {
  config.destHost = candidate.destHost;
  config.destApiKey = candidate.destApiKey;
  config.destUsername = candidate.destUsername;
  config.destPassword = candidate.destPassword;
}

function getTlsOptions(nodeUrl, noVerifyCerts) {
  var parsed = coerceDestUrl(nodeUrl);
  if (!parsed || parsed.protocol !== 'https:') {
    if (noVerifyCerts) {
      return { rejectUnauthorized: false };
    }
    return undefined;
  }
  if (noVerifyCerts || isLocalhostUrl(nodeUrl)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

function oppositeProtocolUrl(nodeUrl) {
  var parsed = coerceDestUrl(nodeUrl);
  if (!parsed) return null;
  var port = explicitPort(nodeUrl, parsed);
  var nextProtocol = parsed.protocol === 'https:' ? 'http:' : 'https:';
  return formatDestUrl(nextProtocol, parsed.hostname, port, parsed.pathname);
}

function isProtocolMismatchError(err) {
  var msg = err && err.message ? err.message : String(err || '');
  var cause = err && err.cause && err.cause.message ? err.cause.message : '';
  var text = msg + ' ' + cause;
  return (
    /wrong version number/i.test(text) ||
    /EPROTO/.test(text) ||
    /ERR_SSL/i.test(text) ||
    /ssl3_get_record/i.test(text) ||
    /tlsv1 alert/i.test(text)
  );
}

function appendOppositeProtocolCandidates(candidates) {
  var seen = {};
  candidates.forEach(function (candidate) {
    seen[formatDestCandidate(candidate)] = true;
  });
  var extras = [];
  candidates.forEach(function (candidate) {
    var flippedHost = oppositeProtocolUrl(candidate.destHost);
    if (!flippedHost) return;
    var extra = Object.assign({}, candidate, { destHost: flippedHost });
    var key = formatDestCandidate(extra);
    if (!seen[key]) {
      seen[key] = true;
      extras.push(extra);
    }
  });
  return extras;
}

module.exports = {
  DEFAULT_DEST_AUTHS: DEFAULT_DEST_AUTHS,
  firstEsHost: firstEsHost,
  coerceDestUrl: coerceDestUrl,
  isLocalhostUrl: isLocalhostUrl,
  destHostCandidates: destHostCandidates,
  destAuthCandidates: destAuthCandidates,
  destCandidates: destCandidates,
  formatDestCandidate: formatDestCandidate,
  applyDestCandidate: applyDestCandidate,
  getTlsOptions: getTlsOptions,
  oppositeProtocolUrl: oppositeProtocolUrl,
  isProtocolMismatchError: isProtocolMismatchError,
  appendOppositeProtocolCandidates: appendOppositeProtocolCandidates,
};
