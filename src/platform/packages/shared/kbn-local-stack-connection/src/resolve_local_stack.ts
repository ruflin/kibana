/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ToolingLog } from '@kbn/tooling-log';
import type { ElasticsearchConnection, ResolveElasticsearchOptions } from './resolve_elasticsearch';
import { resolveElasticsearch } from './resolve_elasticsearch';
import type { KibanaConnection, ResolveKibanaOptions } from './resolve_kibana';
import { resolveKibana } from './resolve_kibana';

export interface LocalStackConnection {
  elasticsearch: ElasticsearchConnection;
  kibana: KibanaConnection;
}

export interface ResolveLocalStackOptions {
  log: ToolingLog;
  elasticsearch?: Omit<ResolveElasticsearchOptions, 'log' | 'insecure' | 'env'>;
  kibana?: Omit<ResolveKibanaOptions, 'log' | 'insecure' | 'env'>;
  insecure?: boolean;
  env?: NodeJS.ProcessEnv;
}

/** Resolves Elasticsearch and Kibana. Kibana tries the Elasticsearch credentials first. */
export const resolveLocalStack = async ({
  log,
  elasticsearch: esOptions = {},
  kibana: kibanaOptions = {},
  insecure,
  env,
}: ResolveLocalStackOptions): Promise<LocalStackConnection> => {
  const elasticsearch = await resolveElasticsearch({ log, insecure, env, ...esOptions });
  const kibana = await resolveKibana({
    log,
    insecure,
    env,
    preferredAuth: elasticsearch.auth,
    ...kibanaOptions,
  });
  return { elasticsearch, kibana };
};
