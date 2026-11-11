/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import moment from 'moment-timezone';
import { esql } from '@elastic/esql';
import type { EsqlQueryRequest } from '@elastic/elasticsearch/lib/api/types';
import { schema } from '@kbn/config-schema';
import { versionCheckHandlerWrapper } from '@kbn/upgrade-assistant-pkg-server';
import {
  API_BASE_PATH,
  APPS_WITH_DEPRECATION_LOGS,
  DEPRECATION_LOGS_ORIGIN_FIELD,
} from '../../common/constants';

import {
  getDeprecationLoggingStatus,
  setDeprecationLogging,
} from '../lib/es_deprecation_logging_apis';
import type { RouteDependencies } from '../types';
import { DEPRECATION_LOGS_INDEX } from '../../common/constants';

export function registerDeprecationLoggingRoutes({
  router,
  lib: { handleEsError },
  current,
}: RouteDependencies) {
  router.get(
    {
      path: `${API_BASE_PATH}/deprecation_logging`,
      security: {
        authz: {
          enabled: false,
          reason: 'Relies on es client for authorization',
        },
      },
      validate: false,
    },
    versionCheckHandlerWrapper(current.major)(async ({ core }, request, response) => {
      try {
        const {
          elasticsearch: { client },
        } = await core;
        const result = await getDeprecationLoggingStatus(client);
        return response.ok({ body: result });
      } catch (error) {
        return handleEsError({ error, response });
      }
    })
  );

  router.put(
    {
      path: `${API_BASE_PATH}/deprecation_logging`,
      security: {
        authz: {
          enabled: false,
          reason: 'Relies on es client for authorization',
        },
      },
      validate: {
        body: schema.object({
          isEnabled: schema.boolean(),
        }),
      },
    },
    versionCheckHandlerWrapper(current.major)(async ({ core }, request, response) => {
      try {
        const {
          elasticsearch: { client },
        } = await core;
        const { isEnabled } = request.body as { isEnabled: boolean };
        return response.ok({
          body: await setDeprecationLogging(client, isEnabled),
        });
      } catch (error) {
        return handleEsError({ error, response });
      }
    })
  );

  router.get(
    {
      path: `${API_BASE_PATH}/deprecation_logging/count`,
      security: {
        authz: {
          enabled: false,
          reason: 'Relies on es client for authorization',
        },
      },
      validate: {
        query: schema.object({
          from: schema.string({ maxLength: 64 }),
        }),
      },
    },
    versionCheckHandlerWrapper(current.major)(async ({ core }, request, response) => {
      try {
        const {
          elasticsearch: { client },
        } = await core;
        const indexExists = await client.asCurrentUser.indices.exists({
          index: DEPRECATION_LOGS_INDEX,
        });

        if (!indexExists) {
          return response.ok({ body: { count: 0 } });
        }

        const now = moment().toISOString();

        // Documents without an origin count too, as with the `must_not` terms query of the DSL.
        const { query, params } = esql.from([DEPRECATION_LOGS_INDEX])
          .where`@timestamp >= TO_DATETIME(${{
          from: request.query.from,
        }}) AND @timestamp <= TO_DATETIME(${{ now }}) AND (${esql.col(
          DEPRECATION_LOGS_ORIGIN_FIELD
        )} IS NULL OR NOT ${esql.col(DEPRECATION_LOGS_ORIGIN_FIELD)} IN (${{
          origins: [...APPS_WITH_DEPRECATION_LOGS],
        }}))`.pipe`STATS count = COUNT(*)`.toRequest();

        const result = await client.asCurrentUser.esql.query({
          query,
          params,
        } as unknown as EsqlQueryRequest);
        const countColumn = result.columns.findIndex((column) => column.name === 'count');
        const count = (result.values[0]?.[countColumn] as number | undefined) ?? 0;

        return response.ok({ body: { count } });
      } catch (error) {
        return handleEsError({ error, response });
      }
    })
  );

  router.delete(
    {
      path: `${API_BASE_PATH}/deprecation_logging/cache`,
      security: {
        authz: {
          enabled: false,
          reason: 'Relies on es client for authorization',
        },
      },
      validate: false,
    },
    versionCheckHandlerWrapper(current.major)(async ({ core }, request, response) => {
      try {
        const {
          elasticsearch: { client },
        } = await core;
        await client.asCurrentUser.transport.request({
          method: 'DELETE',
          path: '/_logging/deprecation_cache',
        });

        return response.ok({ body: 'ok' });
      } catch (error) {
        return handleEsError({ error, response });
      }
    })
  );
}
