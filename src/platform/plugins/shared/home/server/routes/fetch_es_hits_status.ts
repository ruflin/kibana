/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { esql } from '@elastic/esql';
import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import { schema } from '@kbn/config-schema';
import type { IRouter } from '@kbn/core/server';

// Index names the ES|QL parser reads without quotes. Anything else is quoted, so that a name
// supplied by the caller can never end the `FROM` command.
const UNQUOTED_SOURCE = /^[A-Za-z0-9._*:-]+$/;

const toEsqlSource = (source: string): string =>
  UNQUOTED_SOURCE.test(source) ? source : `"${source.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ES|QL reports a missing index as a 400 `verification_exception` ("Unknown index [<name>]").
const isEsqlUnknownIndexError = (error: unknown): boolean => {
  const { statusCode, body } = error as {
    statusCode?: number;
    body?: { error?: { type?: string; reason?: string } };
  };
  return (
    statusCode === 400 &&
    body?.error?.type === 'verification_exception' &&
    (body.error.reason ?? '').includes('Unknown index')
  );
};

export const registerHitsStatusRoute = (router: IRouter) => {
  router.post(
    {
      path: '/api/home/hits_status',
      security: {
        authz: {
          enabled: false,
          reason: 'This route is opted out from authorization',
        },
      },
      validate: {
        body: schema.object({
          index: schema.string({ minLength: 1, maxLength: 1024 }),
          query: schema.recordOf(schema.string({ maxLength: 1024 }), schema.any()),
        }),
      },
    },
    router.handleLegacyErrors(async (context, req, res) => {
      const { index, query } = req.body;
      const client = (await context.core).elasticsearch.client;

      try {
        const sources = index.split(',').map((source) => source.trim());
        // The caller's Query DSL stays in the request `filter`: it is arbitrary DSL.
        const request = {
          ...esql.from(sources.map(toEsqlSource)).limit(1).toRequest(),
          filter: query,
        };
        let count = 0;
        try {
          const response = (await client.asCurrentUser.esql.query(
            request as unknown as EsqlQueryRequest
          )) as unknown as { values: unknown[][] };
          count = response.values.length;
        } catch (e) {
          // A wildcard that matches no index gave no hits with the search; ES|QL fails with
          // `Unknown index` instead. An explicit index name that does not exist stays an error.
          if (!(isEsqlUnknownIndexError(e) && sources.every((source) => source.includes('*')))) {
            throw e;
          }
        }

        return res.ok({
          body: {
            count,
          },
        });
      } catch (e) {
        return res.badRequest({
          body: e,
        });
      }
    })
  );
};
