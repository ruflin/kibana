/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

const { RuleTester } = require('eslint');
const rule = require('./no_hardcoded_local_stack_connection');

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2020,
  },
});

ruleTester.run('@kbn/eslint/no_hardcoded_local_stack_connection', rule, {
  valid: [
    { code: "const es = await resolveElasticsearch({ log, url: flags['es-url'] });" },
    { code: 'new Client({ node: es.url, auth: es.auth, tls: getTlsOptions(es.url) });' },
    { code: 'https.request(url, { rejectUnauthorized: true });' },
    { code: 'https.request(url, { rejectUnauthorized: !flags.insecure });' },
    { code: "const username = 'elastic';" },
    { code: "const message = 'the elastic_serverless user';" },
  ],

  invalid: [
    {
      code: "const users = ['elastic', 'elastic_serverless'];",
      errors: [{ messageId: 'serverlessSuperuser' }],
    },
    {
      code: "const auth = 'elastic_serverless:changeme';",
      errors: [{ messageId: 'serverlessSuperuser' }],
    },
    {
      code: 'const auth = `elastic_serverless:${password}`;',
      errors: [{ messageId: 'serverlessSuperuser' }],
    },
    {
      code: 'new Client({ node, tls: { rejectUnauthorized: false } });',
      errors: [{ messageId: 'rejectUnauthorized' }],
    },
    {
      code: "https.request(url, { 'rejectUnauthorized': false });",
      errors: [{ messageId: 'rejectUnauthorized' }],
    },
  ],
});
