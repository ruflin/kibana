/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ResolveLocalStackOptions } from './resolve_local_stack';

export const LOCAL_STACK_STRING_FLAGS = [
  'es-url',
  'es-username',
  'es-password',
  'es-api-key',
  'kibana-url',
  'kibana-username',
  'kibana-password',
  'kibana-api-key',
] as const;

export const LOCAL_STACK_BOOLEAN_FLAGS = ['insecure'] as const;

/** Help text for {@link LOCAL_STACK_FLAG_OPTIONS}, for scripts that build their own help. */
export const LOCAL_STACK_FLAGS_HELP = `
  --es-url               Elasticsearch URL, may include user:pass@ (env: ELASTICSEARCH_HOST)
                         [default: kibana.dev.yml, then localhost:9200 over http and https]
  --es-username          Elasticsearch username (env: ELASTICSEARCH_USERNAME)
                         [default: elastic, then elastic_serverless]
  --es-password          Elasticsearch password (env: ELASTICSEARCH_PASSWORD) [default: changeme]
  --es-api-key           Elasticsearch API key (env: ELASTICSEARCH_API_KEY)
  --kibana-url           Kibana URL, may include user:pass@ and the base path (env: KIBANA_URL)
                         [default: kibana.dev.yml, then localhost:5601; the dev base path is detected]
  --kibana-username      Kibana username (env: KIBANA_USERNAME) [default: the Elasticsearch user]
  --kibana-password      Kibana password (env: KIBANA_PASSWORD)
  --kibana-api-key       Kibana API key (env: KIBANA_API_KEY)
  --insecure             Skip TLS certificate verification. Local https hosts are verified
                         against the Kibana dev CA and do not need this.
`;

/** Flag options for `run()` from `@kbn/dev-cli-runner`. */
export const LOCAL_STACK_FLAG_OPTIONS = {
  string: [...LOCAL_STACK_STRING_FLAGS],
  boolean: [...LOCAL_STACK_BOOLEAN_FLAGS],
  help: LOCAL_STACK_FLAGS_HELP,
};

const getStringFlag = (flags: Record<string, unknown>, name: string): string | undefined => {
  const value = flags[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/** Maps the {@link LOCAL_STACK_FLAG_OPTIONS} flags to options for `resolveLocalStack`. */
export const getLocalStackOptionsFromFlags = (
  flags: Record<string, unknown>
): Omit<ResolveLocalStackOptions, 'log'> => ({
  elasticsearch: {
    url: getStringFlag(flags, 'es-url'),
    username: getStringFlag(flags, 'es-username'),
    password: getStringFlag(flags, 'es-password'),
    apiKey: getStringFlag(flags, 'es-api-key'),
  },
  kibana: {
    url: getStringFlag(flags, 'kibana-url'),
    username: getStringFlag(flags, 'kibana-username'),
    password: getStringFlag(flags, 'kibana-password'),
    apiKey: getStringFlag(flags, 'kibana-api-key'),
  },
  insecure: flags.insecure === true,
});
