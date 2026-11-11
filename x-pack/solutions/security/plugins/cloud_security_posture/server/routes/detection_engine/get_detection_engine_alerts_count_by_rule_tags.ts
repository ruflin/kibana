/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { esql } from '@elastic/esql';
import { schema } from '@kbn/config-schema';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import { transformError } from '@kbn/securitysolution-es-utils';
import {
  DETECTION_RULE_ALERTS_STATUS_API_CURRENT_VERSION,
  GET_DETECTION_RULE_ALERTS_STATUS_PATH,
} from '../../../common/constants';
import type { CspRouter } from '../../types';
import { esqlRows, runEsql } from '../../lib/esql_read';

const DEFAULT_ALERTS_INDEX = '.alerts-security.alerts-default' as const;

// Keep this aligned with the alerting rule tag contract in
// x-pack/platform/plugins/shared/alerting/common/constants/limits.ts.
const RULE_TAG_MAX_LENGTH = 512;
// maxSize mirrors the cspBenchmarkRuleMetadataSchema tags ceiling: rules
// are not expected to carry more than 100 tags.
const RULE_TAGS_MAX_SIZE = 100;

export const getDetectionEngineAlertsCountByRuleTags = async (
  esClient: ElasticsearchClient,
  tags: string[]
): Promise<number> => {
  // `kibana.alert.rule.tags` is multi-valued, so the tag terms stay in the request filter
  const response = await runEsql({
    esClient,
    query: esql.from([DEFAULT_ALERTS_INDEX]).pipe`STATS total = COUNT(*)`,
    filter: {
      bool: {
        filter: [
          { term: { 'kibana.alert.rule.tags': 'Cloud Security' } },
          ...tags.map((tag) => ({ term: { 'kibana.alert.rule.tags': tag } })),
        ],
      },
    },
  });
  const total = esqlRows(response)[0]?.total;
  return typeof total === 'number' ? total : 0;
};

const getDetectionEngineAlertsStatus = async (esClient: ElasticsearchClient, tags: string[]) => {
  const total = await getDetectionEngineAlertsCountByRuleTags(esClient, tags);

  return {
    total,
  };
};
export const defineGetDetectionEngineAlertsStatus = (router: CspRouter) =>
  router.versioned
    .get({
      access: 'internal',
      path: GET_DETECTION_RULE_ALERTS_STATUS_PATH,
      security: {
        authz: {
          requiredPrivileges: ['cloud-security-posture-read'],
        },
      },
    })
    .addVersion(
      {
        version: DETECTION_RULE_ALERTS_STATUS_API_CURRENT_VERSION,
        validate: {
          request: {
            query: schema.object({
              // maxSize is set to 100 as it's not expected to have more than 100 tags
              tags: schema.arrayOf(schema.string({ maxLength: RULE_TAG_MAX_LENGTH }), {
                maxSize: RULE_TAGS_MAX_SIZE,
              }),
            }),
          },
        },
      },
      async (context, request, response) => {
        const requestBody = request.query;
        const cspContext = await context.csp;

        try {
          const alerts = await getDetectionEngineAlertsStatus(
            cspContext.esClient.asCurrentUser,
            requestBody.tags
          );
          return response.ok({ body: alerts });
        } catch (err) {
          const error = transformError(err);
          cspContext.logger.error(`Failed to fetch csp rules templates ${err}`);
          return response.customError({
            body: { message: error.message },
            statusCode: error.statusCode,
          });
        }
      }
    );
