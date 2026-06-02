#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/**
 * Set up a second local Elasticsearch cluster and register it as a remote on
 * the primary cluster for cross-cluster search (CCS) development.
 *
 * What it does:
 *   1. Starts a second ES (`yarn es snapshot`) with its own base-path, data
 *      dir, cluster name, and HTTP/transport ports (default 9201/9301).
 *   2. Waits for the remote ES to be reachable (yellow|green).
 *   3. Registers the remote on the primary via the Kibana Remote Clusters API
 *      (POST /api/remote_clusters), so it shows up in Management -> Remote
 *      Clusters. Requires Kibana to be running.
 *   4. Prints commands to ingest logs into the remote (scripts/sync_logs.js or
 *      synthtrace) and a sample CCS query to run from the primary.
 *
 * Usage:
 *   node scripts/setup_ccs.js                 # start remote + register (needs Kibana running)
 *   node scripts/setup_ccs.js --no-start      # only register an already-running remote
 *   node scripts/setup_ccs.js --skip-register # only start the remote ES, don't touch Kibana
 *
 * Run with --help for all options.
 */

require('@kbn/setup-node-env');

var spawn = require('child_process').spawn;
var http = require('http');
var path = require('path');
var getopts = require('getopts');

var REPO_ROOT = path.resolve(__dirname, '..');
var REQUEST_TIMEOUT_MS = 30000;

function parseConfig() {
  // `start` and `register` default to true. getopts turns `--no-start` into
  // `start: false` automatically; `--register-only` / `--skip-register` are
  // explicit conveniences handled below.
  var opts = getopts(process.argv.slice(2), {
    alias: { h: 'help' },
    boolean: ['help', 'start', 'register', 'register-only', 'skip-register'],
    default: { start: true, register: true },
    string: [
      'name',
      'http-port',
      'transport-port',
      'base-path',
      'data-dir',
      'kibana-url',
      'kibana-auth',
      'license',
    ],
  });

  // CLI flag > env var > default. getopts sets '' for missing string opts.
  var get = function (flag, envVar, fallback) {
    var optValue = opts[flag];
    var envValue = process.env[envVar];
    return (optValue && String(optValue).trim()) || (envValue && envValue.trim()) || fallback;
  };

  return {
    help: opts.help,
    remoteName: get('name', 'REMOTE_CLUSTER_NAME', 'remote'),
    httpPort: parseInt(get('http-port', 'REMOTE_HTTP_PORT', '9201'), 10),
    transportPort: parseInt(get('transport-port', 'REMOTE_TRANSPORT_PORT', '9301'), 10),
    basePath: get('base-path', 'REMOTE_BASE_PATH', '.es-remote'),
    dataDir: get('data-dir', 'REMOTE_DATA_DIR', '../data_ccs_remote'),
    kibanaUrl: get('kibana-url', 'KIBANA_URL', 'http://localhost:5601').replace(/\/$/, ''),
    kibanaAuth: get('kibana-auth', 'KIBANA_AUTH', 'elastic:changeme'),
    license: get('license', 'REMOTE_LICENSE', 'trial'),
    start: opts.start && !opts['register-only'],
    register: opts.register && !opts['skip-register'],
  };
}

function log(msg) {
  console.log('[setup-ccs] ' + msg);
}

function showHelp() {
  console.log(
    '\n' +
      'Set up a second local Elasticsearch cluster and register it as a remote on the\n' +
      'primary cluster for cross-cluster search (CCS) development.\n\n' +
      'Usage:\n' +
      '  node scripts/setup_ccs.js                 Start remote ES + register on primary (needs Kibana running)\n' +
      '  node scripts/setup_ccs.js --no-start      Only register an already-running remote (alias: --register-only)\n' +
      "  node scripts/setup_ccs.js --skip-register Only start the remote ES; don't touch Kibana\n\n" +
      'Options (CLI flag > env var > default):\n' +
      '  --name            REMOTE_CLUSTER_NAME     Remote alias on the primary (default: remote)\n' +
      '  --http-port       REMOTE_HTTP_PORT        Remote ES HTTP port (default: 9201)\n' +
      '  --transport-port  REMOTE_TRANSPORT_PORT   Remote ES transport port (default: 9301)\n' +
      '  --base-path       REMOTE_BASE_PATH        Install/cache dir for the remote ES (default: .es-remote)\n' +
      '  --data-dir        REMOTE_DATA_DIR         ES path.data for the remote (default: ../data_ccs_remote)\n' +
      '  --kibana-url      KIBANA_URL              Kibana base URL (default: http://localhost:5601)\n' +
      '  --kibana-auth     KIBANA_AUTH             user:pass for Kibana (default: elastic:changeme)\n' +
      '  --license         REMOTE_LICENSE          ES license: basic|trial (default: trial)\n' +
      "  --no-start, --register-only               Don't start the remote ES; just register it\n" +
      "  --skip-register                           Start the remote ES; don't register on the primary\n" +
      '  --help, -h                                This help\n'
  );
}

// Start the second ES via `yarn es snapshot` with isolated ports/data.
function startRemoteEs(config) {
  var esArgs = [
    'es',
    'snapshot',
    '--license=' + config.license,
    '--base-path=' + config.basePath,
    '-E',
    'cluster.name=' + config.remoteName,
    '-E',
    'http.port=' + config.httpPort,
    '-E',
    'transport.port=' + config.transportPort,
    '-E',
    'path.data=' + config.dataDir,
  ];

  log('Starting remote ES: yarn ' + esArgs.join(' '));
  log(
    'Remote HTTP: http://localhost:' + config.httpPort + ' (transport ' + config.transportPort + ')'
  );

  var child = spawn('yarn', esArgs, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('exit', function (code) {
    if (code !== null && code !== 0) {
      log('Remote ES exited with code ' + code + '.');
      process.exit(code);
    }
  });

  // Forward termination so Ctrl-C stops the child ES too.
  var stop = function () {
    if (!child.killed) child.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  return child;
}

// HTTP request returning a Promise of { statusCode, body } (body parsed as JSON when possible).
function request(method, url, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    var parsed = new URL(url);
    var payload = options.body ? JSON.stringify(options.body) : undefined;
    var headers = Object.assign(
      { 'Content-Type': 'application/json' },
      payload ? { 'Content-Length': Buffer.byteLength(payload) } : {},
      options.headers || {}
    );
    var req = http.request(
      {
        method: method,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        auth: options.auth,
        headers: headers,
        timeout: REQUEST_TIMEOUT_MS,
      },
      function (res) {
        var data = '';
        res.on('data', function (chunk) {
          data += chunk;
        });
        res.on('end', function () {
          var parsedBody = data;
          try {
            parsedBody = data ? JSON.parse(data) : undefined;
          } catch (e) {
            // leave as string
          }
          resolve({ statusCode: res.statusCode, body: parsedBody });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy(new Error('request timed out'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// Poll the remote ES cluster health until it is yellow|green (or time out).
function waitForRemoteEs(config) {
  var url =
    'http://localhost:' + config.httpPort + '/_cluster/health?wait_for_status=yellow&timeout=5s';
  var deadline = Date.now() + 5 * 60 * 1000;
  log('Waiting for remote ES to be ready...');

  function attempt() {
    if (Date.now() >= deadline) {
      return Promise.reject(
        new Error('Remote ES did not become ready at http://localhost:' + config.httpPort)
      );
    }
    return request('GET', url, { auth: 'elastic:changeme' })
      .then(function (res) {
        if (
          res.statusCode === 200 &&
          res.body &&
          (res.body.status === 'yellow' || res.body.status === 'green')
        ) {
          log('Remote ES is ' + res.body.status + ' (cluster "' + res.body.cluster_name + '").');
          return true;
        }
        return sleep(3000).then(attempt);
      })
      .catch(function (err) {
        if (err && err.message && err.message.indexOf('did not become ready') !== -1) {
          throw err;
        }
        return sleep(3000).then(attempt);
      });
  }

  return attempt();
}

// Register the remote on the primary via the Kibana Remote Clusters API.
function registerRemoteCluster(config) {
  var url = config.kibanaUrl + '/api/remote_clusters';
  var seed = 'localhost:' + config.transportPort;
  log('Registering remote cluster "' + config.remoteName + '" (seed ' + seed + ') via ' + url);

  var headers = { 'kbn-xsrf': 'setup-ccs', 'x-elastic-internal-origin': 'kibana' };
  var payload = {
    name: config.remoteName,
    mode: 'sniff',
    seeds: [seed],
    skipUnavailable: true,
  };

  return request('POST', url, { auth: config.kibanaAuth, headers: headers, body: payload })
    .then(function (res) {
      // If it already exists, update it instead.
      if (res.statusCode === 409) {
        log('Remote cluster already exists; updating it.');
        var updateBody = {
          mode: payload.mode,
          seeds: payload.seeds,
          skipUnavailable: payload.skipUnavailable,
        };
        return request('PUT', url + '/' + encodeURIComponent(config.remoteName), {
          auth: config.kibanaAuth,
          headers: headers,
          body: updateBody,
        });
      }
      return res;
    })
    .then(function (res) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        log('Remote cluster "' + config.remoteName + '" registered.');
        return true;
      }
      log(
        'Failed to register remote cluster (HTTP ' +
          res.statusCode +
          '): ' +
          JSON.stringify(res.body)
      );
      log(
        'Is Kibana running and reachable at ' +
          config.kibanaUrl +
          '? You can also register manually in Stack Management -> Remote Clusters, or via ES: ' +
          'PUT _cluster/settings { "persistent": { "cluster.remote.' +
          config.remoteName +
          '.seeds": ["' +
          seed +
          '"] } }'
      );
      return false;
    })
    .catch(function (err) {
      log('Could not reach Kibana at ' + config.kibanaUrl + ': ' + err.message);
      log('Start Kibana and re-run with --no-start, or register the remote manually.');
      return false;
    });
}

function printNextSteps(config, registered) {
  var remoteHost = 'http://localhost:' + config.httpPort;
  console.log('\n──────────────────────────────────────────────────────────────');
  log('Next steps');
  console.log('');
  console.log('Ingest logs INTO the remote cluster (so you can read them via CCS):');
  console.log('');
  console.log('  # Option A: copy logs from a source cluster into the remote');
  console.log(
    '  ELASTICSEARCH_HOST=' +
      remoteHost +
      ' \\\n    SOURCE_ELASTICSEARCH_HOST=<source-url> SOURCE_ELASTICSEARCH_API_KEY=<key> \\\n    node scripts/sync_logs.js'
  );
  console.log('');
  console.log('  # Option B: generate synthetic logs directly into the remote');
  console.log('  node scripts/synthtrace.js simple_logs --target=' + remoteHost);
  console.log('');
  if (registered) {
    console.log(
      'Then query them via CCS from your PRIMARY cluster (alias "' + config.remoteName + '"):'
    );
    console.log('');
    console.log('  # Console / Dev Tools on the primary:');
    console.log('  GET ' + config.remoteName + ':logs*/_search');
    console.log('  POST _query  { "query": "FROM ' + config.remoteName + ':logs* | LIMIT 10" }');
    console.log('');
    console.log(
      '  In Discover/Streams, create a data view for "' +
        config.remoteName +
        ':logs*" to see remote logs through CCS.'
    );
  }
  console.log('──────────────────────────────────────────────────────────────\n');
}

function main() {
  var config = parseConfig();

  if (config.help) {
    showHelp();
    process.exit(0);
    return;
  }

  var child;
  var startPromise;
  if (config.start) {
    child = startRemoteEs(config);
    startPromise = waitForRemoteEs(config);
  } else {
    log('--no-start/--register-only: skipping remote ES startup.');
    startPromise = Promise.resolve(true);
  }

  startPromise
    .then(function () {
      if (config.register) {
        return registerRemoteCluster(config);
      }
      log('--skip-register: not registering on the primary cluster.');
      return false;
    })
    .then(function (registered) {
      printNextSteps(config, registered);

      if (child) {
        log('Remote ES is running in the foreground. Press Ctrl-C to stop it.');
        // Keep the process alive alongside the child ES.
      } else {
        process.exit(registered || !config.register ? 0 : 1);
      }
    })
    .catch(function (err) {
      console.error('[setup-ccs] Fatal:', err.message);
      if (child && !child.killed) child.kill('SIGTERM');
      process.exit(1);
    });
}

main();
