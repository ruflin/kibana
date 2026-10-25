/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

require('@kbn/setup-node-env/node_version_validator');

var detect = require('./makelogs_detect');

function startMakelogs() {
  require('@elastic/makelogs');
}

function main() {
  if (detect.hasUserConnectionFlags()) {
    startMakelogs();
    return;
  }

  detect.detectLocalEs().then(function (detected) {
    if (!detected) {
      console.error(
        'Could not detect a running Elasticsearch instance with known credentials.\n' +
          'Tried HTTP/HTTPS on localhost:9200 as elastic and elastic_serverless.\n' +
          'Pass --auth user:password and optionally --url/--host, or set ELASTICSEARCH_HOST.'
      );
      process.exit(1);
      return;
    }
    console.log(
      'Detected Elasticsearch at ' + detected.destHost + ' (auth: ' + detected.username + ')'
    );
    detect.injectDetectedArgv(detected);
    startMakelogs();
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  main: main,
};
