/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/**
 * Flags per-script local stack detection in developer scripts: the hardcoded serverless
 * superuser and disabled TLS certificate verification. Scripts should resolve Elasticsearch and
 * Kibana with `@kbn/local-stack-connection`, which handles local stateful and serverless stacks
 * and trusts the Kibana dev CA for local https hosts.
 */

const SERVERLESS_SUPERUSER = 'elastic_serverless';

const isServerlessSuperuserString = (value) =>
  typeof value === 'string' &&
  (value === SERVERLESS_SUPERUSER || value.startsWith(`${SERVERLESS_SUPERUSER}:`));

const getPropertyName = (key) => {
  if (key.type === 'Identifier') {
    return key.name;
  }
  if (key.type === 'Literal') {
    return String(key.value);
  }
  return undefined;
};

/** @type {import("eslint").Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow hardcoded local serverless credentials and disabled TLS verification in scripts',
    },
    schema: [],
    messages: {
      serverlessSuperuser:
        "Do not hardcode 'elastic_serverless'. Resolve Elasticsearch and Kibana with " +
        '@kbn/local-stack-connection (resolveElasticsearch / resolveKibana / resolveLocalStack), ' +
        'which detects local stateful and serverless stacks.',
      rejectUnauthorized:
        'Do not disable TLS certificate verification. Use getTlsOptions() from ' +
        '@kbn/local-stack-connection, which trusts the Kibana dev CA for local https hosts and ' +
        'only disables verification for an explicit `insecure` opt-in.',
    },
  },

  create(context) {
    return {
      Literal(node) {
        if (isServerlessSuperuserString(node.value)) {
          context.report({ node, messageId: 'serverlessSuperuser' });
        }
      },
      TemplateElement(node) {
        if (isServerlessSuperuserString(node.value.cooked)) {
          context.report({ node, messageId: 'serverlessSuperuser' });
        }
      },
      Property(node) {
        if (
          getPropertyName(node.key) === 'rejectUnauthorized' &&
          node.value.type === 'Literal' &&
          node.value.value === false
        ) {
          context.report({ node, messageId: 'rejectUnauthorized' });
        }
      },
    };
  },
};
