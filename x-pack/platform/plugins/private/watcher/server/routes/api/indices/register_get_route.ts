/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import { esql } from '@elastic/esql';
import { schema } from '@kbn/config-schema';
import type { IScopedClusterClient } from '@kbn/core/server';
import { reduce, size } from 'lodash';
import type { RouteDependencies } from '../../../types';

const bodySchema = schema.object(
  { pattern: schema.string({ maxLength: 1000 }) },
  { unknowns: 'allow' }
);

function getIndexNamesFromAliasesResponse(json: Record<string, any>) {
  return reduce(
    json,
    (list, { aliases }, indexName) => {
      list.push(indexName);
      if (size(aliases) > 0) {
        list.push(...Object.keys(aliases));
      }
      return list;
    },
    [] as string[]
  );
}

// Index names the ES|QL parser reads without quotes. Anything else is quoted, so that a pattern typed
// into the autocomplete can never end the `FROM` command.
const UNQUOTED_SOURCE = /^[A-Za-z0-9._*:-]+$/;
const toEsqlSource = (source: string): string =>
  UNQUOTED_SOURCE.test(source) ? source : `"${source.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ES|QL reports a missing index as a 400 `verification_exception` ("Unknown index [<name>]"),
// where the search answered 404 or no buckets.
const isEsqlUnknownIndexError = (error: unknown): boolean => {
  const { statusCode, body } = (error ?? {}) as {
    statusCode?: number;
    body?: { error?: { type?: string; reason?: string } };
  };
  return (
    statusCode === 400 &&
    body?.error?.type === 'verification_exception' &&
    typeof body.error.reason === 'string' &&
    body.error.reason.includes('Unknown index')
  );
};

export async function getIndices(dataClient: IScopedClusterClient, pattern: string, limit = 10) {
  const aliasResult = await dataClient.asCurrentUser.indices.getAlias(
    {
      index: pattern,
    },
    {
      ignore: [404],
      meta: true,
    }
  );

  if (aliasResult.statusCode !== 404) {
    const indicesFromAliasResponse = getIndexNamesFromAliasesResponse(aliasResult.body);
    return indicesFromAliasResponse.slice(0, limit);
  }

  const sources = pattern
    .split(',')
    .map((source) => source.trim())
    .filter((source) => source.length > 0)
    .map(toEsqlSource);
  if (sources.length === 0) {
    return [];
  }

  // The search returned the indices by document count, then name.
  const { query, params } = esql.from(sources, ['_index'])
    .pipe`STATS doc_count = COUNT(*) BY _index`.pipe`SORT doc_count DESC, _index ASC`
    .limit(limit)
    .toRequest();

  try {
    const response = (await dataClient.asCurrentUser.esql.query({
      query,
      ...(params && params.length > 0 ? { params } : {}),
    } as EsqlQueryRequest)) as unknown as { columns: Array<{ name: string }>; values: unknown[][] };
    const indexColumn = response.columns.findIndex(({ name }) => name === '_index');
    return response.values.map((row) => String(row[indexColumn]));
  } catch (error) {
    if (isEsqlUnknownIndexError(error)) {
      return [];
    }
    throw error;
  }
}

export function registerGetRoute({ router, license, lib: { handleEsError } }: RouteDependencies) {
  router.post(
    {
      path: '/api/watcher/indices',
      security: {
        authz: {
          enabled: false,
          reason: 'Relies on es client for authorization',
        },
      },
      validate: {
        body: bodySchema,
      },
    },
    license.guardApiRoute(async (ctx, request, response) => {
      const { pattern } = request.body;

      try {
        const esClient = (await ctx.core).elasticsearch.client;
        const indices = await getIndices(esClient, pattern);
        return response.ok({ body: { indices } });
      } catch (e) {
        return handleEsError({ error: e, response });
      }
    })
  );
}
