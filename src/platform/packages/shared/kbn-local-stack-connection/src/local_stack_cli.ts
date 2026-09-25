/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { CA_CERT_PATH } from '@kbn/dev-utils';
import { RunWithCommands } from '@kbn/dev-cli-runner';
import { ToolingLog } from '@kbn/tooling-log';
import type { ConnectionAuth } from './auth';
import { isApiKeyAuth } from './auth';
import { getLocalStackOptionsFromFlags, LOCAL_STACK_FLAG_OPTIONS } from './cli_flags';
import { DEV_CERT_HOSTNAME } from './constants';
import { resolveElasticsearch } from './resolve_elasticsearch';
import { resolveKibana } from './resolve_kibana';
import { isLocalUrl, parseUrl } from './url';

const IP_HOSTNAMES = new Set(['127.0.0.1', '0.0.0.0', '[::1]']);

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * The dev certificates only cover hostnames, so local IPs are rewritten to `localhost` for tools
 * like curl that verify against `--cacert` without an override for the expected hostname.
 */
const toCertificateHostname = (url: string): string => {
  const parsed = parseUrl(url);
  if (parsed.protocol !== 'https:' || !IP_HOSTNAMES.has(parsed.hostname)) {
    return url;
  }
  parsed.hostname = DEV_CERT_HOSTNAME;
  return parsed.toString().replace(/\/$/, '');
};

const getAuthVariables = (prefix: string, auth: ConnectionAuth): Record<string, string> =>
  isApiKeyAuth(auth)
    ? { [`${prefix}_API_KEY`]: auth.apiKey }
    : { [`${prefix}_USERNAME`]: auth.username, [`${prefix}_PASSWORD`]: auth.password };

/** Runs `node scripts/local_stack`. */
export const runLocalStackCli = (): void => {
  new RunWithCommands({
    description:
      'Inspect the connection to a local stateful or serverless Elasticsearch and Kibana',
  })
    .command({
      name: 'env',
      description: `
        Resolves Elasticsearch and Kibana like other scripts do and prints shell exports. Logs are
        written to stderr, so the output can be evaluated:

          eval "$(node scripts/local_stack.js env)"

        Exports ELASTICSEARCH_HOST, ELASTICSEARCH_USERNAME / ELASTICSEARCH_PASSWORD (or
        ELASTICSEARCH_API_KEY), the same KIBANA_* variables with KIBANA_URL, LOCAL_STACK_CA_CERT when
        a local https host should be verified against the Kibana dev CA, and LOCAL_STACK_INSECURE
        when --insecure is set.
      `,
      flags: {
        ...LOCAL_STACK_FLAG_OPTIONS,
        string: [...LOCAL_STACK_FLAG_OPTIONS.string, 'config'],
        boolean: [...LOCAL_STACK_FLAG_OPTIONS.boolean, 'skip-kibana', 'skip-elasticsearch'],
        help: `
          --config               Kibana config file [default: config/kibana.dev.yml]
          --skip-kibana          Only resolve Elasticsearch
          --skip-elasticsearch   Only resolve Kibana
          ${LOCAL_STACK_FLAG_OPTIONS.help}
        `,
      },
      run: async ({ flags }) => {
        const log = new ToolingLog({
          level: flags.verbose ? 'verbose' : flags.debug ? 'debug' : 'info',
          writeTo: process.stderr,
        });
        const kibanaConfigPath = typeof flags.config === 'string' ? flags.config : undefined;
        const {
          elasticsearch: esOptions,
          kibana: kibanaOptions,
          insecure,
        } = getLocalStackOptionsFromFlags(flags);

        const variables: Record<string, string> = {};
        const urls: string[] = [];
        let preferredAuth: ConnectionAuth | undefined;

        if (flags['skip-elasticsearch'] !== true) {
          const es = await resolveElasticsearch({ log, insecure, kibanaConfigPath, ...esOptions });
          preferredAuth = es.auth;
          urls.push(es.url);
          Object.assign(variables, {
            ELASTICSEARCH_HOST: toCertificateHostname(es.url),
            ...getAuthVariables('ELASTICSEARCH', es.auth),
          });
        }

        if (flags['skip-kibana'] !== true) {
          const kibana = await resolveKibana({
            log,
            insecure,
            kibanaConfigPath,
            preferredAuth,
            ...kibanaOptions,
          });
          urls.push(kibana.url);
          Object.assign(variables, {
            KIBANA_URL: toCertificateHostname(kibana.url),
            ...getAuthVariables('KIBANA', kibana.auth),
          });
        }

        if (insecure) {
          variables.LOCAL_STACK_INSECURE = 'true';
        } else if (urls.some((url) => url.startsWith('https:') && isLocalUrl(url))) {
          variables.LOCAL_STACK_CA_CERT = CA_CERT_PATH;
        }

        process.stdout.write(
          Object.entries(variables)
            .map(([name, value]) => `export ${name}=${shellQuote(value)}\n`)
            .join('')
        );
      },
    })
    .execute();
};
